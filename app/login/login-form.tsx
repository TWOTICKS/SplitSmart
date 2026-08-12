"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendOtpCode, verifyOtpCode } from "./actions";

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  function submitEmail(formData: FormData) {
    const value = String(formData.get("email") ?? "").trim();
    setErrorMessage("");
    startTransition(async () => {
      const result = await sendOtpCode(formData);
      if (result.ok) {
        setEmail(value);
        setStep("code");
      } else {
        setErrorMessage(result.error ?? "Something went wrong.");
      }
    });
  }

  function submitCode() {
    setErrorMessage("");
    startTransition(async () => {
      const result = await verifyOtpCode(email, code);
      if (result.ok) {
        router.push(next ?? "/trips");
        router.refresh();
      } else {
        setErrorMessage(result.error ?? "Something went wrong.");
      }
    });
  }

  if (step === "code") {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          We sent a code to <strong>{email}</strong>. Enter it below.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 10))}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={10}
            placeholder="12345678"
            className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-center text-lg tracking-[0.3em] dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        {errorMessage && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {errorMessage}
          </p>
        )}
        <button
          type="button"
          onClick={submitCode}
          disabled={isPending || code.length < 4}
          className="h-11 rounded-lg bg-teal-700 font-medium text-white disabled:opacity-60"
        >
          {isPending ? "Verifying…" : "Verify code"}
        </button>
        <button
          type="button"
          onClick={() => {
            setStep("email");
            setCode("");
            setErrorMessage("");
          }}
          className="text-sm text-zinc-500 underline underline-offset-2"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex w-full max-w-sm flex-col gap-4"
      action={(formData) => submitEmail(formData)}
    >
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
        {isPending ? "Sending…" : "Send code"}
      </button>
      {errorMessage && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {errorMessage}
        </p>
      )}
    </form>
  );
}
