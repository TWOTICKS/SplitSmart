/**
 * Pure money math. No I/O, no dates, no imports.
 * All amounts are integer minor units (cents, yen, fils...) — never floats.
 */

// --- currency decimal exponents (minor units per major unit) -------------

const CURRENCY_EXPONENTS: Record<string, number> = {
  JPY: 0,
  KRW: 0,
  VND: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? 2;
}

export function minorUnitsPerMajor(currency: string): number {
  return 10 ** currencyExponent(currency);
}

/** Format minor units as a human string, e.g. 12345 "USD" -> "123.45". No symbol. */
export function formatMajor(amountMinor: number | bigint, currency: string): string {
  const exp = currencyExponent(currency);
  const scale = 10 ** exp;
  const n = Number(amountMinor);
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const whole = Math.floor(abs / scale);
  const frac = abs % scale;
  return exp === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(frac).padStart(exp, "0")}`;
}

// --- rounding --------------------------------------------------------------

/**
 * Converts an amount in `fromCurrency` minor units into `toCurrency` minor
 * units, given a major-unit-to-major-unit fx rate (1 fromCurrency = rate
 * toCurrency — the form every FX API and lib/fx.ts return).
 *
 * A plain `amountMinor * rate` is only correct when both currencies use the
 * same number of decimal places. It silently breaks whenever they don't —
 * e.g. JPY (0 decimals) into SGD (2 decimals) comes out 100x too small,
 * because "8200 minor units of JPY" is 8200 yen, but "8200 minor units of
 * SGD" would be S$82.00, and the naive multiplication conflates the two
 * scales. Scaling by 10^(toExponent - fromExponent) corrects for that.
 */
export function convertMinorUnits(amountMinor: number, fromCurrency: string, toCurrency: string, rate: number): number {
  const scale = 10 ** (currencyExponent(toCurrency) - currencyExponent(fromCurrency));
  return roundHalfUp(amountMinor * rate * scale);
}

/** Half-up rounding on the absolute value: round(2.5) = 3, round(-2.5) = -3. */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(value) + 0.5);
}

// --- largest remainder method ----------------------------------------------

export interface Weighted {
  id: string;
  weight: number; // integer weight (bps, shares, whatever)
}

/**
 * Split `total` minor units among `weighted` members proportional to weight,
 * using the largest-remainder method with integer arithmetic throughout.
 * Deterministic: ties on remainder break by ascending id.
 * Invariant: sum(result.values()) === total, exactly, for all valid inputs.
 */
export function splitByWeight(total: number, weighted: Weighted[]): Map<string, number> {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error("total must be a non-negative integer (minor units)");
  }
  if (weighted.length === 0) {
    throw new Error("weighted must be non-empty");
  }
  const sumWeights = weighted.reduce((s, w) => s + w.weight, 0);
  if (sumWeights <= 0) {
    throw new Error("sum of weights must be positive");
  }
  for (const w of weighted) {
    if (!Number.isInteger(w.weight) || w.weight < 0) {
      throw new Error(`weight for ${w.id} must be a non-negative integer`);
    }
  }

  const floors = new Map<string, number>();
  const remainders = new Map<string, number>();
  let sumFloors = 0;

  for (const w of weighted) {
    const numerator = total * w.weight;
    const floor = Math.floor(numerator / sumWeights);
    const remainder = numerator - floor * sumWeights;
    floors.set(w.id, floor);
    remainders.set(w.id, remainder);
    sumFloors += floor;
  }

  const leftover = total - sumFloors;

  const order = [...weighted]
    .map((w) => w.id)
    .sort((a, b) => {
      const rDiff = (remainders.get(b) ?? 0) - (remainders.get(a) ?? 0);
      if (rDiff !== 0) return rDiff;
      return a < b ? -1 : a > b ? 1 : 0;
    });

  for (let i = 0; i < leftover; i++) {
    const id = order[i];
    floors.set(id, (floors.get(id) ?? 0) + 1);
  }

  return floors;
}

/** Equal split is splitByWeight with weight 1 for every member. */
export function splitEqually(total: number, memberIds: string[]): Map<string, number> {
  return splitByWeight(
    total,
    memberIds.map((id) => ({ id, weight: 1 }))
  );
}

/** Shares/parts split: weight = number of parts (integer >= 1). */
export function splitByShares(total: number, shares: Weighted[]): Map<string, number> {
  return splitByWeight(total, shares);
}

/**
 * Percentage split. Percentages are integer basis points (10000 = 100%).
 * Throws unless they sum to exactly 10000.
 */
export function splitByPercent(total: number, percentBps: Weighted[]): Map<string, number> {
  const sum = percentBps.reduce((s, w) => s + w.weight, 0);
  if (sum !== 10000) {
    throw new Error(`percentages must sum to exactly 100% (10000 bps), got ${sum}`);
  }
  return splitByWeight(total, percentBps);
}

/**
 * Exact-amount split. Each member's amount is given directly.
 * Throws unless the amounts sum to exactly `total`.
 */
export function splitExact(total: number, amounts: Record<string, number>): Map<string, number> {
  const sum = Object.values(amounts).reduce((s, v) => s + v, 0);
  if (sum !== total) {
    throw new Error(`exact amounts must sum to total ${total}, got ${sum}`);
  }
  for (const [id, v] of Object.entries(amounts)) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`amount for ${id} must be a non-negative integer`);
    }
  }
  return new Map(Object.entries(amounts));
}

// --- tax ---------------------------------------------------------------

export interface TaxBreakdown {
  subtotalMinor: number;
  scMinor: number;
  gstMinor: number;
  totalMinor: number;
}

/**
 * Compute service charge then GST-on-(subtotal+service charge), fixed order.
 * scBps/gstBps are basis points (10000 = 100%).
 */
export function computeTax(subtotalMinor: number, scBps: number, gstBps: number): TaxBreakdown {
  if (!Number.isInteger(subtotalMinor) || subtotalMinor < 0) {
    throw new Error("subtotalMinor must be a non-negative integer");
  }
  const scMinor = roundHalfUp((subtotalMinor * scBps) / 10000);
  const gstMinor = roundHalfUp(((subtotalMinor + scMinor) * gstBps) / 10000);
  const totalMinor = subtotalMinor + scMinor + gstMinor;
  return { subtotalMinor, scMinor, gstMinor, totalMinor };
}

/**
 * Back-compute an approximate subtotal from a tax-inclusive total, for display only.
 * The split always operates on `total`, never on this back-computed subtotal.
 * Round-trips to within one minor unit: computeTax(backComputeSubtotal(computeTax(x,..).total,..)).total
 * may differ from the original total by at most 1 minor unit.
 */
export function backComputeSubtotal(totalMinor: number, scBps: number, gstBps: number): TaxBreakdown {
  if (!Number.isInteger(totalMinor) || totalMinor < 0) {
    throw new Error("totalMinor must be a non-negative integer");
  }
  // total = subtotal * (1 + scBps/10000) * (1 + gstBps/10000), inverted then re-derived
  // to keep the same fixed rounding order as computeTax.
  const factor = (1 + scBps / 10000) * (1 + gstBps / 10000);
  const approxSubtotal = roundHalfUp(totalMinor / factor);
  return computeTax(approxSubtotal, scBps, gstBps);
}

// --- balances ------------------------------------------------------------

export interface LedgerEntry {
  memberId: string;
  paidHome: number; // sum of expense_payers.amount_home for this member
  owedHome: number; // sum of expense_splits.amount_home for this member
  settlementsSentHome: number; // sum of settlements where from = member
  settlementsReceivedHome: number; // sum of settlements where to = member
}

/**
 * net(m) = paid - owed + settlementsSent - settlementsReceived
 * net > 0: the group owes m. net < 0: m owes the group.
 * A settlement is money moving from a debtor to a creditor: the sender's net
 * rises toward zero (they've paid off what they owed), the receiver's net
 * falls toward zero (less is now owed to them).
 * Invariant: sum of all nets is 0 — asserted here, throws if violated.
 */
export function computeBalances(entries: LedgerEntry[]): Map<string, number> {
  const nets = new Map<string, number>();
  let sum = 0;
  for (const e of entries) {
    const net = e.paidHome - e.owedHome + e.settlementsSentHome - e.settlementsReceivedHome;
    nets.set(e.memberId, net);
    sum += net;
  }
  if (sum !== 0) {
    throw new Error(`balance invariant violated: sum of net balances is ${sum}, expected 0`);
  }
  return nets;
}

export interface Transfer {
  from: string;
  to: string;
  amountMinor: number;
}

/**
 * Decomposes a net-balance map into pairwise debts: every debtor's balance
 * split across creditors proportional to how much each is owed, using the
 * same largest-remainder method as every split in this module — so each
 * debtor's total is distributed *exactly*, not approximated by rounding
 * each debtor/creditor pair independently (that would let the pairwise
 * amounts drift from the true totals).
 *
 * This is meant to be called on a single expense's local nets (payer(s)
 * minus split shares, nothing else), where in the common single-payer case
 * there's exactly one creditor and the decomposition is unambiguous — every
 * other participant simply owes that payer their share. Calling it on an
 * aggregate net across many unrelated expenses is a different, weaker
 * question ("how should this lump sum be divided among creditors") and
 * produces pairwise numbers that don't correspond to how the debt actually
 * arose — resolve pairwise debts per expense and sum the results instead of
 * decomposing an already-aggregated net.
 */
export function decomposeNetsToTransfers(nets: Map<string, number>): Transfer[] {
  const creditors = [...nets.entries()].filter(([, v]) => v > 0);
  const debtors = [...nets.entries()].filter(([, v]) => v < 0);
  if (creditors.length === 0 || debtors.length === 0) return [];

  const transfers: Transfer[] = [];
  for (const [debtorId, debtAmount] of debtors) {
    const shares = splitByWeight(
      -debtAmount,
      creditors.map(([id, amount]) => ({ id, weight: amount }))
    );
    for (const [creditorId] of creditors) {
      const amount = shares.get(creditorId) ?? 0;
      if (amount > 0) transfers.push({ from: debtorId, to: creditorId, amountMinor: amount });
    }
  }
  return transfers;
}

// --- settle-up (min cash flow) -------------------------------------------

/**
 * Greedy min-cash-flow debt simplification: match the largest creditor with
 * the largest debtor repeatedly. Deterministic: ties break by ascending member id.
 * Produces at most n-1 transfers. Applying the result zeroes every balance.
 */
export function simplifyDebts(nets: Map<string, number>): Transfer[] {
  type Node = { id: string; amount: number };
  const creditors: Node[] = [];
  const debtors: Node[] = [];
  for (const [id, net] of nets) {
    if (net > 0) creditors.push({ id, amount: net });
    else if (net < 0) debtors.push({ id, amount: -net });
  }

  const byAmountThenId = (a: Node, b: Node) => b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;

  while (true) {
    creditors.sort(byAmountThenId);
    debtors.sort(byAmountThenId);
    // remove zeroed entries
    while (creditors.length && creditors[0].amount === 0) creditors.shift();
    while (debtors.length && debtors[0].amount === 0) debtors.shift();
    if (creditors.length === 0 || debtors.length === 0) break;

    const c = creditors[0];
    const d = debtors[0];
    const amount = Math.min(c.amount, d.amount);
    if (amount > 0) {
      transfers.push({ from: d.id, to: c.id, amountMinor: amount });
      c.amount -= amount;
      d.amount -= amount;
    }
    i++;
    j++;
    if (i > nets.size + 5 || j > nets.size + 5) break; // safety valve, unreachable in practice
  }

  return transfers;
}
