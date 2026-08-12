import { createClient as createSupabaseClient } from "@supabase/supabase-js";

interface ClerkWindow {
  Clerk?: { session?: { getToken(): Promise<string | null> } };
}

// Reads the Clerk session token off `window.Clerk` rather than the
// `useSession()` hook, so this factory can be called from plain async
// functions (lib/offline/*) and not just React components.
export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => {
        const clerk = (window as unknown as ClerkWindow).Clerk;
        return (await clerk?.session?.getToken()) ?? null;
      },
    }
  );
}
