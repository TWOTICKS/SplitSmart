import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import type { Expense, Member } from "@/lib/types";
import { DeleteExpenseButton } from "./delete-button";

interface PayerRow {
  member_id: string;
  amount_minor: number;
}
interface SplitRow {
  member_id: string;
  amount_minor: number;
}

export default async function ExpenseDetailPage({ params }: PageProps<"/trips/[tripId]/expense/[expenseId]">) {
  const { tripId, expenseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: expense }, { data: members }] = await Promise.all([
    supabase
      .from("expenses")
      .select("*, expense_payers(member_id, amount_minor), expense_splits(member_id, amount_minor)")
      .eq("id", expenseId)
      .eq("trip_id", tripId)
      .single<Expense & { expense_payers: PayerRow[]; expense_splits: SplitRow[] }>(),
    supabase.from("members").select("*").eq("trip_id", tripId).returns<Member[]>(),
  ]);
  if (!expense || expense.deleted_at) notFound();

  const nameOf = (id: string) => members?.find((m) => m.id === id)?.display_name ?? "?";
  const createdBy = nameOf(expense.created_by);
  const editedBy = expense.updated_by ? nameOf(expense.updated_by) : null;
  const wasEdited = expense.updated_at !== expense.created_at;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{expense.description}</h1>
          <p className="text-sm text-zinc-500">
            {new Date(expense.spent_at + "T00:00:00").toLocaleDateString(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <Link
          href={`/trips/${tripId}/expense/${expenseId}/edit`}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium dark:border-zinc-700"
        >
          Edit
        </Link>
      </div>

      <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Breakdown</h2>
        <dl className="flex flex-col gap-1 text-sm">
          <Row label="Subtotal" value={formatMoney(expense.subtotal_minor, expense.currency)} />
          {expense.sc_minor > 0 && <Row label="Service charge" value={formatMoney(expense.sc_minor, expense.currency)} />}
          {expense.gst_minor > 0 && <Row label="GST" value={formatMoney(expense.gst_minor, expense.currency)} />}
          <Row label="Total" value={formatMoney(expense.total_minor, expense.currency)} bold />
        </dl>
        {expense.fx_stale && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Exchange rate wasn&apos;t available when this was added — the estimate may be off.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Paid by</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {expense.expense_payers.map((p) => (
            <li key={p.member_id} className="flex justify-between">
              <span>{nameOf(p.member_id)}</span>
              <span>{formatMoney(p.amount_minor, expense.currency)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Split</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {expense.expense_splits.map((s) => (
            <li key={s.member_id} className="flex justify-between">
              <span>{nameOf(s.member_id)}</span>
              <span>{formatMoney(s.amount_minor, expense.currency)}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-zinc-500">
        Added by {createdBy}
        {wasEdited && editedBy ? ` · last edited by ${editedBy}` : ""}
      </p>

      <DeleteExpenseButton tripId={tripId} expenseId={expenseId} />
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
