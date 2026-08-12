import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@/lib/supabase/server";
import { JoinConfirmForm } from "./join-confirm-form";

export default async function JoinByLinkPage({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;
  const { userId } = await auth();

  if (!userId) {
    redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);
  }

  const supabase = await createClient();

  const { data: tripName } = await supabase.rpc("trip_name_for_code", { p_code: code });

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      {tripName ? (
        <>
          <h1 className="text-xl font-semibold">Join &ldquo;{tripName}&rdquo;?</h1>
          <JoinConfirmForm code={code} />
        </>
      ) : (
        <p className="text-sm text-zinc-500">This invite code isn&apos;t valid.</p>
      )}
    </main>
  );
}
