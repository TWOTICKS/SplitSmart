"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/app/trips/actions";

export async function addGhostMember(tripId: string, formData: FormData): Promise<ActionResult> {
  const displayName = String(formData.get("display_name") ?? "").trim();
  if (displayName.length < 1 || displayName.length > 60) {
    return { ok: false, error: "Enter a name." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("members").insert({ trip_id: tripId, display_name: displayName });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/settings`);
  return { ok: true };
}

/**
 * Claim an unclaimed ghost member as the signed-in user. Joining a trip by
 * invite code always creates the user's own member row first (join_trip),
 * so claiming a ghost means retiring that empty auto-created row and moving
 * the ghost's user_id onto it instead — the ghost id is what expense
 * history points to, so it must be the row that survives.
 * Blocked if the user's own row already has expense/settlement history,
 * since merging that would mean rewriting the ledger.
 * The DB trigger separately blocks re-claiming an already-claimed member.
 */
export async function claimGhostMember(tripId: string, ghostMemberId: string): Promise<ActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Not signed in." };
  const supabase = await createClient();

  const { data: myMember, error: myMemberError } = await supabase
    .from("members")
    .select("id")
    .eq("trip_id", tripId)
    .eq("user_id", userId)
    .maybeSingle();
  if (myMemberError) return { ok: false, error: myMemberError.message };
  if (!myMember) return { ok: false, error: "You must join this trip before claiming a member." };
  if (myMember.id === ghostMemberId) return { ok: true }; // already this member

  const [payers, splits, settlementsFrom, settlementsTo] = await Promise.all([
    supabase.from("expense_payers").select("expense_id", { count: "exact", head: true }).eq("member_id", myMember.id),
    supabase.from("expense_splits").select("expense_id", { count: "exact", head: true }).eq("member_id", myMember.id),
    supabase.from("settlements").select("id", { count: "exact", head: true }).eq("from_member", myMember.id),
    supabase.from("settlements").select("id", { count: "exact", head: true }).eq("to_member", myMember.id),
  ]);
  const hasHistory =
    (payers.count ?? 0) > 0 || (splits.count ?? 0) > 0 || (settlementsFrom.count ?? 0) > 0 || (settlementsTo.count ?? 0) > 0;
  if (hasHistory) {
    return { ok: false, error: "You've already added expenses under your own name — ask the trip creator to merge manually." };
  }

  const { error: deleteError } = await supabase.from("members").delete().eq("id", myMember.id);
  if (deleteError) return { ok: false, error: deleteError.message };

  const { error: claimError } = await supabase
    .from("members")
    .update({ user_id: userId })
    .eq("id", ghostMemberId)
    .is("user_id", null);
  if (claimError) return { ok: false, error: claimError.message };

  revalidatePath(`/trips/${tripId}`);
  revalidatePath(`/trips/${tripId}/settings`);
  return { ok: true };
}
