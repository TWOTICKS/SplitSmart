"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getLatestFxRate } from "@/lib/fx";
import type { ActionResult } from "@/app/trips/actions";

function bpsFromPercentInput(raw: FormDataEntryValue | null): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return Math.round(value * 100);
}

export async function updateTripSettings(tripId: string, formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const scBps = bpsFromPercentInput(formData.get("sc_percent"));
  const gstBps = bpsFromPercentInput(formData.get("gst_percent"));
  const simplifyDebts = formData.get("simplify_debts") === "on";

  if (name.length < 1 || name.length > 80) return { ok: false, error: "Trip name is required." };
  if (scBps === null) return { ok: false, error: "Service charge must be between 0 and 100%." };
  if (gstBps === null) return { ok: false, error: "GST must be between 0 and 100%." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("trips")
    .update({ name, sc_bps: scBps, gst_bps: gstBps, simplify_debts: simplifyDebts })
    .eq("id", tripId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/settings`);
  return { ok: true };
}

/**
 * Changes a trip's home currency. Every existing expense and settlement
 * stores fx_rate_to_home against the OLD home currency, so relabeling
 * without re-anchoring those rates would leave every historical balance
 * silently wrong. This re-resolves each row's rate — original currency to
 * the NEW home currency, as of that row's own date, the same way it was
 * resolved on initial entry (lib/fx.ts) — then writes the new currency and
 * every updated rate together in one transaction (update_home_currency
 * RPC), so nothing is ever left half-migrated.
 */
export async function updateHomeCurrency(tripId: string, newCurrency: string): Promise<ActionResult> {
  if (!/^[A-Z]{3}$/.test(newCurrency)) return { ok: false, error: "Pick a currency." };

  const supabase = await createClient();
  const { data: trip } = await supabase.from("trips").select("home_currency").eq("id", tripId).single();
  if (!trip) return { ok: false, error: "Trip not found." };
  if (trip.home_currency === newCurrency) return { ok: true };

  const [{ data: expenses, error: expensesError }, { data: settlements, error: settlementsError }] = await Promise.all([
    supabase.from("expenses").select("id, currency, spent_at").eq("trip_id", tripId).is("deleted_at", null),
    supabase.from("settlements").select("id, currency, settled_at").eq("trip_id", tripId).is("deleted_at", null),
  ]);
  if (expensesError) return { ok: false, error: expensesError.message };
  if (settlementsError) return { ok: false, error: settlementsError.message };

  const rateCache = new Map<string, { rate: number; stale: boolean }>();
  async function rateFor(currency: string, asOf: string) {
    const key = `${currency}|${asOf}`;
    const cached = rateCache.get(key);
    if (cached) return cached;
    const resolved = await getLatestFxRate(supabase, currency, newCurrency, asOf);
    rateCache.set(key, resolved);
    return resolved;
  }

  const expenseRates = await Promise.all(
    (expenses ?? []).map(async (e) => {
      const { rate, stale } = await rateFor(e.currency, e.spent_at);
      return { id: e.id, rate, stale };
    })
  );
  const settlementRates = await Promise.all(
    (settlements ?? []).map(async (s) => {
      const { rate } = await rateFor(s.currency, s.settled_at);
      return { id: s.id, rate };
    })
  );

  const { error } = await supabase.rpc("update_home_currency", {
    p_trip_id: tripId,
    p_new_currency: newCurrency,
    p_expense_rates: expenseRates,
    p_settlement_rates: settlementRates,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/balances`);
  revalidatePath(`/trips/${tripId}/settings`);
  return { ok: true };
}

export async function archiveTrip(tripId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("trips").update({ archived_at: new Date().toISOString() }).eq("id", tripId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/trips");
  redirect("/trips");
}
