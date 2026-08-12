"use server";

import { createClient } from "@/lib/supabase/server";

export interface SendLinkResult {
  ok: boolean;
  error?: string;
}

export async function sendMagicLink(formData: FormData): Promise<SendLinkResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const next = String(formData.get("next") ?? "/trips");

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
