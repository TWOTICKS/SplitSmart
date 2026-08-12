import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTripBalances } from "@/lib/balances";
import { formatMoney } from "@/lib/format";
import type { Trip } from "@/lib/types";
import { TripsFab } from "./trips-fab";

export default async function TripsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: trips, error } = await supabase
    .from("trips")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;

  const tripsWithBalance = await Promise.all(
    (trips ?? []).map(async (trip: Trip) => {
      const { members, nets } = await getTripBalances(supabase, trip.id, trip.home_currency);
      const me = members.find((m) => m.user_id === user.id);
      const myNet = me ? nets.get(me.id) ?? 0 : 0;
      return { trip, memberCount: members.length, myNet };
    })
  );

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6 pb-24">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Your trips</h1>
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-sm text-zinc-500 underline underline-offset-2">
            Sign out
          </button>
        </form>
      </div>

      {tripsWithBalance.length === 0 && (
        <p className="mt-12 text-center text-sm text-zinc-500">
          No trips yet. Tap + to start one or join with an invite code.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {tripsWithBalance.map(({ trip, memberCount, myNet }) => (
          <li key={trip.id}>
            <Link
              href={`/trips/${trip.id}`}
              className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="font-medium">{trip.name}</span>
              <span className="text-xs text-zinc-500">
                {memberCount} member{memberCount === 1 ? "" : "s"} · {trip.home_currency}
              </span>
              {myNet === 0 ? (
                <span className="text-sm text-zinc-500">Settled up</span>
              ) : myNet > 0 ? (
                <span className="text-sm font-medium text-teal-700 dark:text-teal-400">
                  You are owed {formatMoney(myNet, trip.home_currency)}
                </span>
              ) : (
                <span className="text-sm font-medium text-red-600 dark:text-red-400">
                  You owe {formatMoney(-myNet, trip.home_currency)}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <TripsFab />
    </main>
  );
}
