"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { uuidv7 } from "uuidv7";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@/lib/supabase/server";
import { resolveExpense, ExpenseValidationError, type ExpenseFormInput } from "@/lib/expense-builder";
import { getLatestFxRate } from "@/lib/fx";
import type { ActionResult } from "@/app/trips/actions";

export interface ExpenseSubmission extends ExpenseFormInput {
  id?: string; // present when editing
  description: string;
  category: string | null;
  currency: string;
  spentAt: string;
}

export async function saveExpense(tripId: string, submission: ExpenseSubmission): Promise<ActionResult & { id?: string }> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  if (submission.description.trim().length < 1 || submission.description.trim().length > 140) {
    return { ok: false, error: "Description must be 1-140 characters." };
  }

  let resolved;
  try {
    resolved = resolveExpense(submission);
  } catch (e) {
    if (e instanceof ExpenseValidationError) return { ok: false, error: e.message };
    throw e;
  }

  const { data: trip } = await supabase.from("trips").select("home_currency").eq("id", tripId).single();
  if (!trip) return { ok: false, error: "Trip not found." };

  let fxRate = 1;
  let fxStale = false;
  if (submission.currency === trip.home_currency) {
    fxRate = 1;
  } else {
    const rate = await getLatestFxRate(supabase, submission.currency, trip.home_currency, submission.spentAt);
    fxRate = rate.rate;
    fxStale = rate.stale;
  }

  const id = submission.id ?? uuidv7();
  const payersJson = submission.payers.map((p) => ({ member_id: p.memberId, amount_minor: p.amountMinor }));

  // input_value preserves what the user actually typed (shares count, percent)
  // so re-opening the edit form shows their original inputs, not derived amounts.
  const rawInputByMember = new Map<string, number>();
  if (submission.splitMode === "shares") {
    for (const s of submission.shareWeights) rawInputByMember.set(s.memberId, s.shares);
  } else if (submission.splitMode === "percent") {
    for (const p of submission.percentBps) rawInputByMember.set(p.memberId, p.bps / 100);
  }
  const splitsJson = [...resolved.splits.entries()].map(([memberId, amountMinor]) => ({
    member_id: memberId,
    amount_minor: amountMinor,
    input_value: rawInputByMember.get(memberId) ?? null,
  }));

  const { error } = await supabase.rpc("upsert_expense", {
    p_id: id,
    p_trip_id: tripId,
    p_description: submission.description.trim(),
    p_category: submission.category,
    p_currency: submission.currency,
    p_subtotal_minor: resolved.tax.subtotalMinor,
    p_sc_minor: resolved.tax.scMinor,
    p_gst_minor: resolved.tax.gstMinor,
    p_total_minor: resolved.tax.totalMinor,
    p_fx_rate_to_home: fxRate,
    p_fx_stale: fxStale,
    p_spent_at: submission.spentAt,
    p_split_mode: submission.splitMode,
    p_tax_inclusive: submission.taxInclusive,
    p_payers: payersJson,
    p_splits: splitsJson,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/balances`);
  revalidatePath(`/trips/${tripId}/expense/${id}`);
  return { ok: true, id };
}

export async function deleteExpense(tripId: string, expenseId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("soft_delete_expense", { p_id: expenseId });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/balances`);
  redirect(`/trips/${tripId}?deleted=${expenseId}`);
}

/** Reverses deleteExpense within the 5-second undo window shown on the trip list. */
export async function restoreExpense(tripId: string, expenseId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("expenses").update({ deleted_at: null }).eq("id", expenseId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/balances`);
  return { ok: true };
}
