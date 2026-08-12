import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMajor } from "@/lib/money";
import { ExpenseForm, type ExpenseFormInitial } from "../../expense-form";
import type { Expense, Member, Trip } from "@/lib/types";

interface PayerRow {
  member_id: string;
  amount_minor: number;
}
interface SplitRow {
  member_id: string;
  amount_minor: number;
  input_value: number | null;
}

export default async function EditExpensePage({ params }: PageProps<"/trips/[tripId]/expense/[expenseId]/edit">) {
  const { tripId, expenseId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: trip }, { data: members }, { data: expense }] = await Promise.all([
    supabase.from("trips").select("*").eq("id", tripId).single<Trip>(),
    supabase.from("members").select("*").eq("trip_id", tripId).order("created_at").returns<Member[]>(),
    supabase
      .from("expenses")
      .select("*, expense_payers(member_id, amount_minor), expense_splits(member_id, amount_minor, input_value)")
      .eq("id", expenseId)
      .eq("trip_id", tripId)
      .single<Expense & { expense_payers: PayerRow[]; expense_splits: SplitRow[] }>(),
  ]);
  if (!trip || !members || !expense || expense.deleted_at) notFound();

  const me = members.find((m) => m.user_id === user.id);
  if (!me) redirect(`/trips/${tripId}/settings`);

  const amountMajor = formatMajor(
    expense.tax_inclusive ? expense.total_minor : expense.subtotal_minor,
    expense.currency
  );

  const initial: ExpenseFormInitial = {
    id: expense.id,
    description: expense.description,
    category: expense.category ?? "",
    currency: expense.currency,
    amountMajor,
    taxInclusive: expense.tax_inclusive,
    applyTax: expense.sc_minor > 0 || expense.gst_minor > 0,
    spentAt: expense.spent_at,
    splitMode: expense.split_mode,
    participantIds: expense.expense_splits.map((s) => s.member_id),
    shareWeights: Object.fromEntries(
      expense.expense_splits.map((s) => [s.member_id, String(s.input_value ?? 0)])
    ),
    percentInputs: Object.fromEntries(
      expense.expense_splits.map((s) => [s.member_id, String(s.input_value ?? 0)])
    ),
    exactInputs: Object.fromEntries(
      expense.expense_splits.map((s) => [s.member_id, formatMajor(s.amount_minor, expense.currency)])
    ),
    payers: Object.fromEntries(
      expense.expense_payers.map((p) => [p.member_id, formatMajor(p.amount_minor, expense.currency)])
    ),
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Edit expense</h1>
      <ExpenseForm
        tripId={tripId}
        members={members}
        myMemberId={me.id}
        tripScBps={trip.sc_bps}
        tripGstBps={trip.gst_bps}
        homeCurrency={trip.home_currency}
        initial={initial}
      />
    </div>
  );
}
