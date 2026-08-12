"use client";

import { useOutbox } from "@/lib/offline/use-outbox";
import { formatMoney } from "@/lib/format";

export function PendingExpenses({ tripId }: { tripId: string }) {
  const pending = useOutbox(tripId, "expense");
  if (pending.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Not yet synced</h2>
      <ul className="flex flex-col gap-2">
        {pending.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between rounded-xl border border-dashed border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40"
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
              <div className="flex flex-col">
                <span className="font-medium">{item.displayDescription}</span>
                <span className="text-xs text-zinc-500">{formatMoney(item.displayTotalMinor, item.displayCurrency)}</span>
              </div>
            </div>
            <span className="text-xs text-amber-700 dark:text-amber-400">waiting to sync</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
