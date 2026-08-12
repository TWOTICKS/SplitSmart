import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : undefined;
  if (user) redirect(nextPath ?? "/trips");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">SplitSmart</h1>
        <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
          Split trip expenses with your group. No password — we&apos;ll email you a code.
        </p>
      </div>
      <LoginForm next={nextPath} />
    </main>
  );
}
