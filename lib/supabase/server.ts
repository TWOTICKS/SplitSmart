import { auth } from "@clerk/nextjs/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Supabase's Third-Party Auth support: Clerk issues the JWT, Supabase
// validates it (once Clerk is registered as a provider in the Supabase
// dashboard) and maps it to the "authenticated" role for RLS. No cookie
// adapter needed here — Clerk owns the session, not Supabase.
export async function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => (await auth()).getToken(),
    }
  );
}
