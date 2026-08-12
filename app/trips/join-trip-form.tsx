"use client";

import { useState, useTransition } from "react";
import { joinTripByCode } from "./actions";

export function JoinTripForm({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      action={(formData) => {
        startTransition(async () => {
          const result = await joinTripByCode(formData);
          if (result && !result.ok) setError(result.error ?? "Something went wrong.");
        });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Invite code</span>
        <input
          name="code"
          required
          maxLength={8}
          autoCapitalize="characters"
          placeholder="ABCD1234"
          className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base uppercase tracking-widest dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDone}
          className="h-11 flex-1 rounded-lg border border-zinc-300 font-medium dark:border-zinc-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="h-11 flex-1 rounded-lg bg-teal-700 font-medium text-white disabled:opacity-60"
        >
          {isPending ? "Joining…" : "Join trip"}
        </button>
      </div>
    </form>
  );
}
