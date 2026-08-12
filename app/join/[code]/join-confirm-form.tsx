"use client";

import { useState, useTransition } from "react";
import { joinTripByCode } from "@/app/trips/actions";

export function JoinConfirmForm({ code }: { code: string }) {
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex w-full max-w-xs flex-col gap-3"
      action={(formData) => {
        startTransition(async () => {
          const result = await joinTripByCode(formData);
          if (result && !result.ok) setError(result.error ?? "Something went wrong.");
        });
      }}
    >
      <input type="hidden" name="code" value={code} />
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending}
        className="h-11 rounded-lg bg-teal-700 font-medium text-white disabled:opacity-60"
      >
        {isPending ? "Joining…" : "Join trip"}
      </button>
    </form>
  );
}
