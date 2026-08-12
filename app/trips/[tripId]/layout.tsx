import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@/lib/supabase/server";
import { TripTabs } from "./trip-tabs";
import { SyncBanner } from "./sync-banner";

export default async function TripLayout({ children, params }: LayoutProps<"/trips/[tripId]">) {
  const { tripId } = await params;
  const { userId } = await auth();
  if (!userId) redirect("/login");
  const supabase = await createClient();

  const { data: trip } = await supabase.from("trips").select("*").eq("id", tripId).single();
  if (!trip) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Link href="/trips" aria-label="Back to trips" className="text-zinc-500">
              ←
            </Link>
            <h1 className="text-lg font-semibold">{trip.name}</h1>
          </div>
          <Link href={`/trips/${tripId}/settings`} aria-label="Trip settings" className="text-zinc-500">
            ⚙
          </Link>
        </div>
        <TripTabs tripId={tripId} />
      </header>
      <SyncBanner tripId={tripId} />
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 py-4 pb-24">{children}</div>
    </div>
  );
}
