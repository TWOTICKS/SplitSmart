"use client";

import { useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { db, type OutboxItem } from "./db";

export function useOutbox(tripId?: string, kind?: OutboxItem["kind"]): OutboxItem[] {
  const [items, setItems] = useState<OutboxItem[]>([]);

  useEffect(() => {
    const database = db;
    if (!database) return;
    const subscription = liveQuery(() =>
      database.outbox.filter((item) => (!tripId || item.tripId === tripId) && (!kind || item.kind === kind)).toArray()
    ).subscribe({
      next: setItems,
      error: () => setItems([]),
    });
    return () => subscription.unsubscribe();
  }, [tripId, kind]);

  return items;
}
