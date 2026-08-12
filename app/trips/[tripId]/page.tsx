import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { AddExpenseFab } from "./add-expense-fab";
import { UndoSnackbar } from "./undo-snackbar";
import { PendingExpenses } from "./pending-expenses";

interface ExpenseRow {
  id: string;
  description: string;
  currency: string;
  total_minor: number;
  spent_at: string;
  fx_stale: boolean;
  expense_payers: { member_id: string; amount_minor: number }[];
  expense_splits: { member_id: string; amount_minor: number }[];
}

export default async function TripExpensesPage({ params, searchParams }: PageProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const { deleted } = await searchParams;
  const deletedExpenseId = typeof deleted === "string" ? deleted : undefined;
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const supabase = await createClient();

  const { data: members } = await supabase.from("members").select("id, user_id").eq("trip_id", tripId);
  const me = members?.find((m) => m.user_id === userId);

  const { data: expenses, error } = await supabase
    .from("expenses")
    .select("id, description, currency, total_minor, spent_at, fx_stale, expense_payers(member_id, amount_minor), expense_splits(member_id, amount_minor)")
    .eq("trip_id", tripId)
    .is("deleted_at", null)
    .order("spent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<ExpenseRow[]>();
  if (error) throw error;

  const groups = new Map<string, ExpenseRow[]>();
  for (const e of expenses ?? []) {
    const list = groups.get(e.spent_at) ?? [];
    list.push(e);
    groups.set(e.spent_at, list);
  }

  return (
    <div className="flex flex-col gap-6">
      <PendingExpenses tripId={tripId} />

      {(expenses?.length ?? 0) === 0 && (
        <p className="mt-12 text-center text-sm text-zinc-500">
          No expenses yet. Tap + to add the first one.
        </p>
      )}

      {[...groups.entries()].map(([date, rows]) => (
        <div key={date} className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {new Date(date + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </h2>
          <ul className="flex flex-col gap-2">
            {rows.map((e) => {
              const paidByMe = e.expense_payers.filter((p) => p.member_id === me?.id).reduce((s, p) => s + p.amount_minor, 0);
              const owedByMe = e.expense_splits.filter((s) => s.member_id === me?.id).reduce((s, sp) => s + sp.amount_minor, 0);
              const lent = paidByMe - owedByMe;
              return (
                <li key={e.id}>
                  <Link
                    href={`/trips/${tripId}/expense/${e.id}`}
                    className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
                  >
                    <div className="flex flex-col">
                      <span className="font-medium">{e.description}</span>
                      <span className="text-xs text-zinc-500">
                        {formatMoney(e.total_minor, e.currency)}
                        {e.fx_stale && " · rate not confirmed"}
                      </span>
                    </div>
                    {lent !== 0 && (
                      <span
                        className={`text-sm font-medium ${lent > 0 ? "text-teal-700 dark:text-teal-400" : "text-red-600 dark:text-red-400"}`}
                      >
                        {lent > 0 ? `you lent ${formatMoney(lent, e.currency)}` : `you owe ${formatMoney(-lent, e.currency)}`}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <AddExpenseFab tripId={tripId} />
      {deletedExpenseId && <UndoSnackbar tripId={tripId} deletedExpenseId={deletedExpenseId} />}
    </div>
  );
}
