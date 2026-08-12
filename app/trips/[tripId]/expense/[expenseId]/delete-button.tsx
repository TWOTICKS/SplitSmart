"use client";

import { useTransition } from "react";
import { deleteExpense } from "../actions";

export function DeleteExpenseButton({ tripId, expenseId }: { tripId: string; expenseId: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          await deleteExpense(tripId, expenseId);
        })
      }
      className="h-11 rounded-lg border border-red-300 font-medium text-red-600 disabled:opacity-60 dark:border-red-900 dark:text-red-400"
    >
      {isPending ? "Deleting…" : "Delete expense"}
    </button>
  );
}
