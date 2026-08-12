"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreExpense } from "./expense/actions";

export function UndoSnackbar({ tripId, deletedExpenseId }: { tripId: string; deletedExpenseId: string }) {
  const [visible, setVisible] = useState(true);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [deletedExpenseId]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-24 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">
      <span>Expense deleted</span>
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            await restoreExpense(tripId, deletedExpenseId);
            setVisible(false);
            router.refresh();
          });
        }}
        className="font-semibold text-teal-400 dark:text-teal-700"
      >
        {isPending ? "Undoing…" : "Undo"}
      </button>
    </div>
  );
}
