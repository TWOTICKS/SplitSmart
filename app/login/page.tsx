import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { SignIn } from "@clerk/nextjs";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { userId } = await auth();
  const { next } = await searchParams;
  const nextPath = typeof next === "string" && next.startsWith("/") ? next : "/trips";
  if (userId) redirect(nextPath);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">SplitSmart</h1>
        <p className="max-w-xs text-sm text-zinc-600 dark:text-zinc-400">
          Split trip expenses with your group.
        </p>
      </div>
      <SignIn fallbackRedirectUrl={nextPath} signUpFallbackRedirectUrl={nextPath} />
    </main>
  );
}
