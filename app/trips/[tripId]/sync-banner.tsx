"use client";

import { useOutbox } from "@/lib/offline/use-outbox";

export function SyncBanner({ tripId }: { tripId: string }) {
  const pending = useOutbox(tripId);
  if (pending.length === 0) return null;

  return (
    <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
      {pending.length} change{pending.length === 1 ? "" : "s"} waiting to sync
    </div>
  );
}
