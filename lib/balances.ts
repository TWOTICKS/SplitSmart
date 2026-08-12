import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeBalances,
  convertMinorUnits,
  decomposeNetsToTransfers,
  simplifyDebts,
  type LedgerEntry,
  type Transfer,
} from "./money";
import type { Member } from "./types";

interface ExpenseWithLines {
  currency: string;
  fx_rate_to_home: number;
  expense_payers: { member_id: string; amount_minor: number }[];
  expense_splits: { member_id: string; amount_minor: number }[];
}

interface SettlementRow {
  from_member: string;
  to_member: string;
  currency: string;
  amount_minor: number;
  fx_rate_to_home: number;
}

/**
 * Loads a trip's members, expenses (with payer/split lines), and settlements,
 * converts every line to home-currency minor units using its own stored
 * fx_rate_to_home, and computes each member's net balance.
 * Throws (via computeBalances) if the ledger doesn't sum to zero.
 */
export async function getTripBalances(
  supabase: SupabaseClient,
  tripId: string,
  homeCurrency: string
): Promise<{ members: Member[]; nets: Map<string, number> }> {
  const [membersRes, expensesRes, settlementsRes] = await Promise.all([
    supabase.from("members").select("*").eq("trip_id", tripId).order("created_at"),
    supabase
      .from("expenses")
      .select(
        "currency, fx_rate_to_home, expense_payers(member_id, amount_minor), expense_splits(member_id, amount_minor)"
      )
      .eq("trip_id", tripId)
      .is("deleted_at", null),
    supabase
      .from("settlements")
      .select("from_member, to_member, currency, amount_minor, fx_rate_to_home")
      .eq("trip_id", tripId)
      .is("deleted_at", null),
  ]);

  if (membersRes.error) throw membersRes.error;
  if (expensesRes.error) throw expensesRes.error;
  if (settlementsRes.error) throw settlementsRes.error;

  const members = (membersRes.data ?? []) as Member[];
  const expenses = (expensesRes.data ?? []) as unknown as ExpenseWithLines[];
  const settlements = (settlementsRes.data ?? []) as SettlementRow[];

  const paid = new Map<string, number>();
  const owed = new Map<string, number>();
  const sent = new Map<string, number>();
  const received = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v);

  for (const e of expenses) {
    for (const p of e.expense_payers) {
      bump(paid, p.member_id, convertMinorUnits(p.amount_minor, e.currency, homeCurrency, e.fx_rate_to_home));
    }
    for (const s of e.expense_splits) {
      bump(owed, s.member_id, convertMinorUnits(s.amount_minor, e.currency, homeCurrency, e.fx_rate_to_home));
    }
  }

  for (const s of settlements) {
    const homeAmount = convertMinorUnits(s.amount_minor, s.currency, homeCurrency, s.fx_rate_to_home);
    bump(sent, s.from_member, homeAmount);
    bump(received, s.to_member, homeAmount);
  }

  const entries: LedgerEntry[] = members.map((m) => ({
    memberId: m.id,
    paidHome: paid.get(m.id) ?? 0,
    owedHome: owed.get(m.id) ?? 0,
    settlementsSentHome: sent.get(m.id) ?? 0,
    settlementsReceivedHome: received.get(m.id) ?? 0,
  }));

  const nets = computeBalances(entries);
  return { members, nets };
}

/** Minimal-transaction settle-up suggestion from aggregate net balances. */
export function getSettleUpPlan(nets: Map<string, number>): Transfer[] {
  return simplifyDebts(nets);
}

function accumulate(ledger: Map<string, number>, from: string, to: string, amount: number): void {
  const key = `${from}|${to}`;
  ledger.set(key, (ledger.get(key) ?? 0) + amount);
}

/** Nets opposite-direction pairwise debts against each other and returns one Transfer per non-zero pair. */
function netLedger(ledger: Map<string, number>): Transfer[] {
  const seenPairs = new Set<string>();
  const transfers: Transfer[] = [];
  for (const key of ledger.keys()) {
    const [a, b] = key.split("|");
    const pairKey = [a, b].sort().join("|");
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    const net = (ledger.get(`${a}|${b}`) ?? 0) - (ledger.get(`${b}|${a}`) ?? 0);
    if (net > 0) transfers.push({ from: a, to: b, amountMinor: net });
    else if (net < 0) transfers.push({ from: b, to: a, amountMinor: -net });
  }
  return transfers.sort(
    (x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : x.to < y.to ? -1 : x.to > y.to ? 1 : 0)
  );
}

export interface PairwiseDebts {
  members: Member[];
  /** Pairwise debts converted to and netted in the trip's home currency. */
  homeCurrencyTransfers: Transfer[];
  /** Pairwise debts kept in each expense's original currency, unconverted. */
  byCurrency: { currency: string; transfers: Transfer[] }[];
}

/**
 * The literal "who owes whom" picture, built by resolving each expense's
 * debts individually — not by aggregating everyone's net balance first and
 * then guessing how to redistribute it. That distinction matters as soon as
 * there's more than one payer in the trip: a global net-then-redistribute
 * approach blends unrelated expenses together and produces pairwise numbers
 * that don't correspond to how the debt actually arose. Resolving per
 * expense is unambiguous in the common single-payer case (everyone else
 * simply owes that payer their share) and stays correct with multiple
 * payers too (lib/money.ts's decomposeNetsToTransfers, largest-remainder).
 *
 * Settlements are real payments, not expense debt, so they're applied
 * directly (in the reverse direction, so they cancel the debt they're
 * paying off) rather than decomposed. They're always recorded in the trip's
 * home currency, so they only ever affect homeCurrencyTransfers — a
 * settlement doesn't have an "original currency" to attribute back to a
 * specific per-currency expense debt.
 */
export async function getPairwiseDebts(
  supabase: SupabaseClient,
  tripId: string,
  homeCurrency: string
): Promise<PairwiseDebts> {
  const [membersRes, expensesRes, settlementsRes] = await Promise.all([
    supabase.from("members").select("*").eq("trip_id", tripId).order("created_at"),
    supabase
      .from("expenses")
      .select(
        "currency, fx_rate_to_home, expense_payers(member_id, amount_minor), expense_splits(member_id, amount_minor)"
      )
      .eq("trip_id", tripId)
      .is("deleted_at", null),
    supabase
      .from("settlements")
      .select("from_member, to_member, currency, amount_minor, fx_rate_to_home")
      .eq("trip_id", tripId)
      .is("deleted_at", null),
  ]);

  if (membersRes.error) throw membersRes.error;
  if (expensesRes.error) throw expensesRes.error;
  if (settlementsRes.error) throw settlementsRes.error;

  const members = (membersRes.data ?? []) as Member[];
  const expenses = (expensesRes.data ?? []) as unknown as ExpenseWithLines[];
  const settlements = (settlementsRes.data ?? []) as SettlementRow[];

  const homeLedger = new Map<string, number>();
  const currencyLedgers = new Map<string, Map<string, number>>();
  function ledgerFor(currency: string): Map<string, number> {
    let l = currencyLedgers.get(currency);
    if (!l) {
      l = new Map();
      currencyLedgers.set(currency, l);
    }
    return l;
  }

  for (const e of expenses) {
    const paid = new Map<string, number>();
    const owed = new Map<string, number>();
    for (const p of e.expense_payers) paid.set(p.member_id, (paid.get(p.member_id) ?? 0) + p.amount_minor);
    for (const s of e.expense_splits) owed.set(s.member_id, (owed.get(s.member_id) ?? 0) + s.amount_minor);

    const memberIds = new Set([...paid.keys(), ...owed.keys()]);
    const localEntries: LedgerEntry[] = [...memberIds].map((id) => ({
      memberId: id,
      paidHome: paid.get(id) ?? 0,
      owedHome: owed.get(id) ?? 0,
      settlementsSentHome: 0,
      settlementsReceivedHome: 0,
    }));
    const localTransfers = decomposeNetsToTransfers(computeBalances(localEntries));

    const currencyLedger = ledgerFor(e.currency);
    for (const t of localTransfers) {
      accumulate(currencyLedger, t.from, t.to, t.amountMinor);
      accumulate(homeLedger, t.from, t.to, convertMinorUnits(t.amountMinor, e.currency, homeCurrency, e.fx_rate_to_home));
    }
  }

  for (const s of settlements) {
    const homeAmount = convertMinorUnits(s.amount_minor, s.currency, homeCurrency, s.fx_rate_to_home);
    accumulate(homeLedger, s.to_member, s.from_member, homeAmount);
  }

  const byCurrency = [...currencyLedgers.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, ledger]) => ({ currency, transfers: netLedger(ledger) }));

  return { members, homeCurrencyTransfers: netLedger(homeLedger), byCurrency };
}
