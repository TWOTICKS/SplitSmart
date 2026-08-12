"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // no 0/O/1/I — avoids ambiguity when read aloud

function generateInviteCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createTrip(formData: FormData): Promise<ActionResult> {
  const name = String(formData.get("name") ?? "").trim();
  const homeCurrency = String(formData.get("home_currency") ?? "").trim().toUpperCase();

  if (name.length < 1 || name.length > 80) return { ok: false, error: "Trip name is required." };
  if (!/^[A-Z]{3}$/.test(homeCurrency)) return { ok: false, error: "Pick a home currency." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  let tripId: string | null = null;
  // invite_code is globally unique; retry a couple of times on collision (birthday-bound, effectively never happens)
  for (let attempt = 0; attempt < 5 && !tripId; attempt++) {
    const { data, error } = await supabase
      .from("trips")
      .insert({
        name,
        home_currency: homeCurrency,
        invite_code: generateInviteCode(),
        created_by: user.id,
      })
      .select("id")
      .single();

    if (!error) {
      tripId = data.id;
      break;
    }
    if (error.code !== "23505") {
      return { ok: false, error: error.message };
    }
  }
  if (!tripId) return { ok: false, error: "Could not create trip, please try again." };

  const displayName = user.email?.split("@")[0] ?? "Me";
  const { error: memberError } = await supabase
    .from("members")
    .insert({ trip_id: tripId, user_id: user.id, display_name: displayName });
  if (memberError) return { ok: false, error: memberError.message };

  revalidatePath("/trips");
  redirect(`/trips/${tripId}`);
}

export async function joinTripByCode(formData: FormData): Promise<ActionResult> {
  const code = String(formData.get("code") ?? "").trim();
  if (code.length < 4) return { ok: false, error: "Enter the invite code." };

  const supabase = await createClient();
  const { data: tripId, error } = await supabase.rpc("join_trip", { p_code: code });
  if (error) return { ok: false, error: "That code didn't match a trip." };

  revalidatePath("/trips");
  redirect(`/trips/${tripId}`);
}
