import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExpenseForm } from "../expense-form";
import type { Member, Trip } from "@/lib/types";

export default async function NewExpensePage({ params }: PageProps<"/trips/[tripId]/expense/new">) {
  const { tripId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: trip }, { data: members }] = await Promise.all([
    supabase.from("trips").select("*").eq("id", tripId).single<Trip>(),
    supabase.from("members").select("*").eq("trip_id", tripId).order("created_at").returns<Member[]>(),
  ]);
  if (!trip || !members) notFound();

  const me = members.find((m) => m.user_id === user.id);
  if (!me) redirect(`/trips/${tripId}/settings`);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Add expense</h1>
      <ExpenseForm
        tripId={tripId}
        members={members}
        myMemberId={me.id}
        tripScBps={trip.sc_bps}
        tripGstBps={trip.gst_bps}
        homeCurrency={trip.home_currency}
      />
    </div>
  );
}
