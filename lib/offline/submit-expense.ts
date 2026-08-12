"use client";

import { uuidv7 } from "uuidv7";
import { createClient } from "@/lib/supabase/client";
import { getLatestFxRate } from "@/lib/fx";
import { resolveExpense, type ExpenseFormInput } from "@/lib/expense-builder";
import { db } from "./db";
import { flushOutbox } from "./sync";

export interface ExpenseCreateSubmission extends ExpenseFormInput {
  description: string;
  category: string | null;
  currency: string;
  spentAt: string;
}

export interface SubmitResult {
  ok: boolean;
  id?: string;
  error?: string;
  queued?: boolean;
}

/**
 * Creates a new expense, local-first: resolves totals/splits/fx entirely in
 * the browser (lib/expense-builder and lib/money are pure, no server round
 * trip needed), then tries to write immediately. If that write can't reach
 * Supabase — offline, or the request just fails — the same write is queued
 * in the local outbox and retried automatically once the network returns,
 * instead of failing the save.
 */
export async function submitExpenseOffline(
  tripId: string,
  homeCurrency: string,
  submission: ExpenseCreateSubmission
): Promise<SubmitResult> {
  const resolved = resolveExpense(submission); // throws ExpenseValidationError — caller validates before calling this
  const supabase = createClient();
  const id = uuidv7();

  let fxRate = 1;
  let fxStale = false;
  if (submission.currency !== homeCurrency) {
    try {
      const r = await getLatestFxRate(supabase, submission.currency, homeCurrency, submission.spentAt);
      fxRate = r.rate;
      fxStale = r.stale;
    } catch {
      fxRate = 1;
      fxStale = true;
    }
  }

  const args = {
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
    p_payers: submission.payers.map((p) => ({ member_id: p.memberId, amount_minor: p.amountMinor })),
    p_splits: [...resolved.splits.entries()].map(([memberId, amountMinor]) => ({
      member_id: memberId,
      amount_minor: amountMinor,
      input_value: null,
    })),
  };

  try {
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
    const { error } = await supabase.rpc("upsert_expense", args);
    if (error) throw error;
    return { ok: true, id };
  } catch {
    if (db) {
      await db.outbox.put({
        id,
        kind: "expense",
        tripId,
        args,
        createdAt: Date.now(),
        displayDescription: submission.description,
        displayCurrency: submission.currency,
        displayTotalMinor: resolved.tax.totalMinor,
        displaySpentAt: submission.spentAt,
      });
      void flushOutbox(); // in case the failure was transient rather than actually offline
    }
    return { ok: true, id, queued: true };
  }
}
