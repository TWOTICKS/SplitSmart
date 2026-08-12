"use client";

import { useState, useTransition } from "react";
import { sendMagicLink } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const [status, setStatus] = useState<"idle" | "sent" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-4"
      action={(formData) => {
        startTransition(async () => {
          const result = await sendMagicLink(formData);
          if (result.ok) {
            setStatus("sent");
          } else {
            setStatus("error");
            setErrorMessage(result.error ?? "Something went wrong.");
          }
        });
      }}
    >
      {next && <input type="hidden" name="next" value={next} />}
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="h-11 rounded-lg bg-teal-700 font-medium text-white disabled:opacity-60"
      >
        {isPending ? "Sending…" : "Send magic link"}
      </button>
      {status === "sent" && (
        <p className="text-sm text-teal-700 dark:text-teal-400" role="status">
          Check your email for a sign-in link.
        </p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
