import { notFound, redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "./settings-form";
import { HomeCurrencyForm } from "./home-currency-form";
import { MembersPanel } from "./members-panel";
import { InviteCodeCard } from "./invite-code-card";
import type { Member, Trip } from "@/lib/types";

export default async function TripSettingsPage({ params }: PageProps<"/trips/[tripId]/settings">) {
  const { tripId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const supabase = await createClient();

  const [{ data: trip }, { data: members }] = await Promise.all([
    supabase.from("trips").select("*").eq("id", tripId).single<Trip>(),
    supabase.from("members").select("*").eq("trip_id", tripId).order("created_at").returns<Member[]>(),
  ]);
  if (!trip) notFound();

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-500">Members</h2>
        <MembersPanel tripId={tripId} members={members ?? []} myUserId={userId} />
      </section>

      <InviteCodeCard code={trip.invite_code} />

      <a
        href={`/trips/${tripId}/export`}
        className="flex h-11 items-center justify-center rounded-lg border border-zinc-300 text-sm font-medium dark:border-zinc-700"
      >
        Export as CSV
      </a>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-500">Trip settings</h2>
        <div className="flex flex-col gap-6">
          <HomeCurrencyForm tripId={tripId} homeCurrency={trip.home_currency} />
          <SettingsForm trip={trip} />
        </div>
      </section>
    </div>
  );
}
