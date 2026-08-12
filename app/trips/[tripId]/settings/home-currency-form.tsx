"use client";

import { useState, useTransition } from "react";
import { updateHomeCurrency } from "./actions";

const COMMON_CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "THB", "MYR", "AUD", "IDR", "VND", "KRW", "KWD"];

export function HomeCurrencyForm({ tripId, homeCurrency }: { tripId: string; homeCurrency: string }) {
  const [currency, setCurrency] = useState(homeCurrency);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const changed = currency !== homeCurrency;

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Home currency</span>
        <select
          value={currency}
          onChange={(e) => {
            setCurrency(e.target.value);
            setSaved(false);
            setError("");
          }}
          className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
        >
          {COMMON_CURRENCIES.includes(homeCurrency) ? null : <option value={homeCurrency}>{homeCurrency}</option>}
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-zinc-500">
        Every balance is shown in this currency. Changing it re-converts every existing expense and
        settlement using their original amounts — nothing is retyped, but the exchange rates behind
        the scenes all get refreshed, which can take a few seconds.
      </p>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      {saved && !error && (
        <p className="text-sm text-teal-700 dark:text-teal-400" role="status">
          Home currency updated.
        </p>
      )}

      {changed && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (!confirm(`Switch this trip's home currency to ${currency}? Balances will be recalculated.`)) return;
            setError("");
            startTransition(async () => {
              const result = await updateHomeCurrency(tripId, currency);
              if (result.ok) setSaved(true);
              else setError(result.error ?? "Something went wrong.");
            });
          }}
          className="h-11 rounded-lg bg-teal-700 font-medium text-white disabled:opacity-60"
        >
          {isPending ? "Recalculating…" : `Switch to ${currency}`}
        </button>
      )}
    </div>
  );
}
