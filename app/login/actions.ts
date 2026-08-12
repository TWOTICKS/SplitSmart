"use server";

import { createClient } from "@/lib/supabase/server";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Sends a one-time code by email. Deliberately does NOT pass emailRedirectTo
 * for a clickable link — a redirect-based flow means the sign-in has to
 * survive a hop through the email provider's link (which some providers
 * auto-visit with a scanner bot before the user ever clicks) and back to
 * this app, all while a PKCE cookie set on the first visit has to still be
 * present and correct on the second. A typed code has no hop to survive:
 * the browser that requested it is the same one that submits it, always.
 */
export async function sendOtpCode(formData: FormData): Promise<ActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function verifyOtpCode(email: string, token: string): Promise<ActionResult> {
  if (!/^\d{4,10}$/.test(token.trim())) {
    return { ok: false, error: "Enter the code from the email." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token: token.trim(), type: "email" });

  if (error) return { ok: false, error: "That code is wrong or expired — request a new one." };
  return { ok: true };
}
