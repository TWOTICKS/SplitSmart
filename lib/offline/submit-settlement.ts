"use client";

import { uuidv7 } from "uuidv7";
import { createClient } from "@/lib/supabase/client";
import { db } from "./db";
import { flushOutbox } from "./sync";
import type { SubmitResult } from "./submit-expense";

export async function submitSettlementOffline(
  tripId: string,
  homeCurrency: string,
  input: { fromMember: string; toMember: string; amountMinor: number; note?: string }
): Promise<SubmitResult> {
  if (input.fromMember === input.toMember) return { ok: false, error: "Payer and recipient must differ." };
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    return { ok: false, error: "Enter an amount greater than zero." };
  }

  const supabase = createClient();
  const id = uuidv7();
  const args = {
    id,
    trip_id: tripId,
    from_member: input.fromMember,
    to_member: input.toMember,
    currency: homeCurrency,
    amount_minor: input.amountMinor,
    fx_rate_to_home: 1,
    settled_at: new Date().toISOString().slice(0, 10),
    note: input.note ?? null,
  };

  try {
    if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
    const { error } = await supabase.from("settlements").insert(args);
    if (error) throw error;
    return { ok: true, id };
  } catch {
    if (db) {
      await db.outbox.put({
        id,
        kind: "settlement",
        tripId,
        args,
        createdAt: Date.now(),
        displayDescription: input.note ?? "Payment",
        displayCurrency: homeCurrency,
        displayTotalMinor: input.amountMinor,
        displaySpentAt: args.settled_at,
      });
      void flushOutbox();
    }
    return { ok: true, id, queued: true };
  }
}
