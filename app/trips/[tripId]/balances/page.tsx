import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTripBalances, getPairwiseDebts, getSettleUpPlan } from "@/lib/balances";
import { formatMoney } from "@/lib/format";
import type { Trip } from "@/lib/types";
import { SettleUpList } from "./settle-up-list";

export default async function BalancesPage({ params }: PageProps<"/trips/[tripId]/balances">) {
  const { tripId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: trip } = await supabase.from("trips").select("*").eq("id", tripId).single<Trip>();
  if (!trip) notFound();

  const [{ members, nets }, { homeCurrencyTransfers, byCurrency }] = await Promise.all([
    getTripBalances(supabase, tripId, trip.home_currency),
    getPairwiseDebts(supabase, tripId, trip.home_currency),
  ]);
  const sorted = [...members].sort((a, b) => (nets.get(b.id) ?? 0) - (nets.get(a.id) ?? 0));
  const plan = trip.simplify_debts ? getSettleUpPlan(nets) : [];
  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? "?";

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">By currency</h2>
        {byCurrency.every(({ transfers }) => transfers.length === 0) ? (
          <p className="text-sm text-zinc-500">No expenses yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {byCurrency.flatMap(({ currency, transfers }) =>
              transfers.map((t) => (
                <li
                  key={`${currency}-${t.from}-${t.to}`}
                  className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
                >
                  <span>
                    <strong>{nameOf(t.from)}</strong> owes <strong>{nameOf(t.to)}</strong>
                  </span>
                  <span className="font-medium">{formatMoney(t.amountMinor, currency)}</span>
                </li>
              ))
            )}
          </ul>
        )}
        <p className="mt-2 text-xs text-zinc-500">
          Each expense&apos;s original currency, not converted — for the actual payback amount see
          Settle up below, in {trip.home_currency}.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Balances ({trip.home_currency})
        </h2>
        <ul className="flex flex-col gap-2">
          {sorted.map((m) => {
            const net = nets.get(m.id) ?? 0;
            return (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <span className="flex items-center gap-2 font-medium">
                  {m.display_name}
                  {m.user_id === user.id && <span className="text-xs font-normal text-zinc-500">(you)</span>}
                </span>
                {net === 0 ? (
                  <span className="text-sm text-zinc-500">settled up</span>
                ) : net > 0 ? (
                  <span className="text-sm font-medium text-teal-700 dark:text-teal-400">
                    is owed {formatMoney(net, trip.home_currency)}
                  </span>
                ) : (
                  <span className="text-sm font-medium text-red-600 dark:text-red-400">
                    owes {formatMoney(-net, trip.home_currency)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            {trip.simplify_debts ? "Settle up" : "Who owes whom"}
          </h2>
        </div>
        <SettleUpList
          tripId={tripId}
          members={members}
          homeCurrency={trip.home_currency}
          transfers={trip.simplify_debts ? plan : homeCurrencyTransfers}
        />
      </section>
    </div>
  );
}
