import Dexie, { type EntityTable } from "dexie";

/**
 * A queued write that couldn't reach Supabase yet. `args` is whatever the
 * eventual supabase-js call needs (RPC params or a table row) — the queue
 * doesn't need to understand the payload, only replay it in order.
 * The display* fields are a denormalized copy so the UI can render a
 * pending row without waiting on a network round trip.
 */
export interface OutboxItem {
  id: string; // same id used for the eventual expense/settlement row — replay is an upsert, so retries are idempotent
  kind: "expense" | "settlement";
  tripId: string;
  args: Record<string, unknown>;
  createdAt: number;
  lastError?: string;
  displayDescription: string;
  displayCurrency: string;
  displayTotalMinor: number;
  displaySpentAt: string;
}

class TabbyDB extends Dexie {
  outbox!: EntityTable<OutboxItem, "id">;

  constructor() {
    super("tabby");
    this.version(1).stores({
      outbox: "id, tripId, kind, createdAt",
    });
  }
}

// Dexie touches indexedDB at construction time, which doesn't exist during SSR.
export const db = typeof window !== "undefined" ? new TabbyDB() : null;
