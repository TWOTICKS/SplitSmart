"use client";

import { createClient } from "@/lib/supabase/client";
import { db, type OutboxItem } from "./db";

async function replay(item: OutboxItem): Promise<void> {
  const supabase = createClient();
  if (item.kind === "expense") {
    const { error } = await supabase.rpc("upsert_expense", item.args);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("settlements").insert(item.args);
    if (error && error.code !== "23505") throw error; // 23505 = already inserted by a previous retry
  }
}

let flushing = false;

/**
 * Replays queued writes in the order they were made. Stops at the first
 * failure rather than skipping ahead — a later write might depend on an
 * earlier one existing (e.g. editing an expense that hasn't synced yet),
 * and retrying out of order would be a worse bug than waiting.
 */
export async function flushOutbox(): Promise<void> {
  if (!db || flushing || typeof navigator === "undefined" || !navigator.onLine) return;
  flushing = true;
  try {
    const items = await db.outbox.orderBy("createdAt").toArray();
    for (const item of items) {
      try {
        await replay(item);
        await db.outbox.delete(item.id);
      } catch (e) {
        await db.outbox.update(item.id, { lastError: e instanceof Error ? e.message : String(e) });
        break;
      }
    }
  } finally {
    flushing = false;
  }
}

export function startSyncListeners(): () => void {
  if (typeof window === "undefined") return () => {};

  const onOnline = () => void flushOutbox();
  const onFocus = () => void flushOutbox();
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  void flushOutbox();
  const interval = setInterval(() => void flushOutbox(), 30_000);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    clearInterval(interval);
  };
}
