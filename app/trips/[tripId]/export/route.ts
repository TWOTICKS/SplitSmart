import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@/lib/supabase/server";
import { formatMajor } from "@/lib/money";

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export async function GET(_request: Request, { params }: RouteContext<"/trips/[tripId]/export">) {
  const { tripId } = await params;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const supabase = await createClient();

  const [{ data: trip }, { data: members }, { data: expenses }, { data: settlements }] = await Promise.all([
    supabase.from("trips").select("name").eq("id", tripId).single(),
    supabase.from("members").select("id, display_name").eq("trip_id", tripId),
    supabase
      .from("expenses")
      .select(
        "description, currency, subtotal_minor, sc_minor, gst_minor, total_minor, spent_at, split_mode, expense_payers(member_id, amount_minor), expense_splits(member_id, amount_minor)"
      )
      .eq("trip_id", tripId)
      .is("deleted_at", null)
      .order("spent_at"),
    supabase
      .from("settlements")
      .select("from_member, to_member, currency, amount_minor, settled_at, note")
      .eq("trip_id", tripId)
      .is("deleted_at", null)
      .order("settled_at"),
  ]);

  if (!trip) return NextResponse.json({ error: "Trip not found" }, { status: 404 });

  const nameOf = (id: string) => members?.find((m) => m.id === id)?.display_name ?? id;

  const rows: string[][] = [
    ["Type", "Date", "Description", "Currency", "Subtotal", "Service charge", "GST", "Total", "Paid by", "Split (who owes what)"],
  ];

  for (const e of expenses ?? []) {
    const paidBy = e.expense_payers.map((p) => `${nameOf(p.member_id)}: ${formatMajor(p.amount_minor, e.currency)}`).join("; ");
    const split = e.expense_splits.map((s) => `${nameOf(s.member_id)}: ${formatMajor(s.amount_minor, e.currency)}`).join("; ");
    rows.push([
      "Expense",
      e.spent_at,
      e.description,
      e.currency,
      formatMajor(e.subtotal_minor, e.currency),
      formatMajor(e.sc_minor, e.currency),
      formatMajor(e.gst_minor, e.currency),
      formatMajor(e.total_minor, e.currency),
      paidBy,
      split,
    ]);
  }

  for (const s of settlements ?? []) {
    rows.push([
      "Settlement",
      s.settled_at,
      s.note ?? "",
      s.currency,
      "",
      "",
      "",
      formatMajor(s.amount_minor, s.currency),
      nameOf(s.from_member),
      nameOf(s.to_member),
    ]);
  }

  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const filename = `${trip.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-export.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
