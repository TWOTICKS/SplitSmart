"use client";

import { useState } from "react";
import { NewTripForm } from "./new-trip-form";
import { JoinTripForm } from "./join-trip-form";

type Mode = "closed" | "menu" | "new" | "join";

export function TripsFab() {
  const [mode, setMode] = useState<Mode>("closed");
  const close = () => setMode("closed");

  return (
    <>
      <button
        type="button"
        onClick={() => setMode("menu")}
        aria-label="New or join trip"
        className="fixed bottom-6 right-6 flex h-14 w-14 items-center justify-center rounded-full bg-teal-700 text-3xl font-light text-white shadow-lg"
      >
        +
      </button>

      {mode !== "closed" && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={close}>
          <div
            className="w-full max-w-sm rounded-t-2xl bg-white p-6 dark:bg-zinc-900 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {mode === "menu" && (
              <div className="flex flex-col gap-3">
                <h2 className="text-lg font-semibold">New or join a trip</h2>
                <button
                  type="button"
                  onClick={() => setMode("new")}
                  className="h-11 rounded-lg bg-teal-700 font-medium text-white"
                >
                  Create a new trip
                </button>
                <button
                  type="button"
                  onClick={() => setMode("join")}
                  className="h-11 rounded-lg border border-zinc-300 font-medium dark:border-zinc-700"
                >
                  Join with invite code
                </button>
                <button type="button" onClick={close} className="h-11 text-sm text-zinc-500">
                  Cancel
                </button>
              </div>
            )}
            {mode === "new" && (
              <div className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold">New trip</h2>
                <NewTripForm onDone={close} />
              </div>
            )}
            {mode === "join" && (
              <div className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold">Join a trip</h2>
                <JoinTripForm onDone={close} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
