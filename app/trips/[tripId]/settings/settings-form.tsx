"use client";

import { useState, useTransition } from "react";
import { updateTripSettings, archiveTrip } from "./actions";
import type { Trip } from "@/lib/types";

export function SettingsForm({ trip }: { trip: Trip }) {
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isArchiving, startArchiving] = useTransition();

  return (
    <div className="flex flex-col gap-8">
      <form
        className="flex flex-col gap-4"
        action={(formData) => {
          setSaved(false);
          startTransition(async () => {
            const result = await updateTripSettings(trip.id, formData);
            if (result.ok) setSaved(true);
            else setError(result.error ?? "Something went wrong.");
          });
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Trip name</span>
          <input
            name="name"
            defaultValue={trip.name}
            required
            maxLength={80}
            className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium">Service charge %</span>
            <input
              name="sc_percent"
              type="number"
              step="0.01"
              min={0}
              max={100}
              defaultValue={(trip.sc_bps / 100).toString()}
              inputMode="decimal"
              className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium">GST %</span>
            <input
              name="gst_percent"
              type="number"
              step="0.01"
              min={0}
              max={100}
              defaultValue={(trip.gst_bps / 100).toString()}
              inputMode="decimal"
              className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>
        <p className="text-xs text-zinc-500">
          Defaults for new expenses — service charge applies to the subtotal, GST applies on top of that.
          Each expense can override these.
        </p>

        <label className="flex items-center gap-2">
          <input type="checkbox" name="simplify_debts" defaultChecked={trip.simplify_debts} className="h-4 w-4" />
          <span className="text-sm">Simplify debts in the settle-up plan</span>
        </label>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
        {saved && !error && (
          <p className="text-sm text-teal-700 dark:text-teal-400" role="status">
            Saved.
          </p>
        )}

        <button
          type="submit"
          disabled={isPending}
          className="h-11 rounded-lg bg-teal-700 font-medium text-white disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Save changes"}
        </button>
      </form>

      <div className="flex flex-col gap-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-red-600 dark:text-red-400">Danger zone</h2>
        <button
          type="button"
          disabled={isArchiving}
          onClick={() => {
            if (confirm(`Archive "${trip.name}"? It will be hidden from your trips list.`)) {
              startArchiving(async () => {
                await archiveTrip(trip.id);
              });
            }
          }}
          className="h-11 rounded-lg border border-red-300 font-medium text-red-600 disabled:opacity-60 dark:border-red-900 dark:text-red-400"
        >
          {isArchiving ? "Archiving…" : "Archive trip"}
        </button>
      </div>
    </div>
  );
}
