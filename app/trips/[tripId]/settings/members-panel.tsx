"use client";

import { useRef, useState, useTransition } from "react";
import { addGhostMember, claimGhostMember } from "../members-actions";
import type { Member } from "@/lib/types";

export function MembersPanel({
  tripId,
  members,
  myUserId,
}: {
  tripId: string;
  members: Member[];
  myUserId: string;
}) {
  const [error, setError] = useState("");
  const [isAdding, startAdding] = useTransition();
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [isClaiming, startClaiming] = useTransition();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const iAmAlreadyAMember = members.some((m) => m.user_id === myUserId);

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
          >
            <span className="flex items-center gap-2 text-sm">
              {m.display_name}
              {m.user_id === myUserId && <span className="text-xs text-zinc-500">(you)</span>}
              {!m.user_id && (
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">
                  not on SplitSmart
                </span>
              )}
            </span>
            {!m.user_id && (
              <button
                type="button"
                disabled={isClaiming}
                onClick={() => {
                  setError("");
                  setClaimingId(m.id);
                  startClaiming(async () => {
                    const result = await claimGhostMember(tripId, m.id);
                    if (!result.ok) setError(result.error ?? "Something went wrong.");
                  });
                }}
                className="text-xs font-medium text-teal-700 dark:text-teal-400"
              >
                {isClaiming && claimingId === m.id ? "Claiming…" : "This is me"}
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {!iAmAlreadyAMember && (
        <p className="text-xs text-zinc-500">
          You&apos;re viewing this trip but aren&apos;t a member yet — use the invite code below to join.
        </p>
      )}

      <form
        className="flex gap-2"
        action={(formData) => {
          startAdding(async () => {
            const result = await addGhostMember(tripId, formData);
            if (!result.ok) setError(result.error ?? "Something went wrong.");
            else if (nameInputRef.current) nameInputRef.current.value = "";
          });
        }}
      >
        <input
          ref={nameInputRef}
          name="display_name"
          placeholder="Add someone by name"
          required
          maxLength={60}
          className="h-11 flex-1 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={isAdding}
          className="h-11 rounded-lg bg-teal-700 px-4 font-medium text-white disabled:opacity-60"
        >
          Add
        </button>
      </form>
    </div>
  );
}
