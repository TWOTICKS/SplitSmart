"use client";

import { useState, useTransition } from "react";
import { formatMoney, parseMoneyInput } from "@/lib/format";
import type { Member } from "@/lib/types";
import { submitSettlementOffline } from "@/lib/offline/submit-settlement";

interface Transfer {
  from: string;
  to: string;
  amountMinor: number;
}

export function SettleUpList({
  tripId,
  members,
  homeCurrency,
  transfers,
}: {
  tripId: string;
  members: Member[];
  homeCurrency: string;
  transfers: Transfer[];
}) {
  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? "?";
  const [recordedKeys, setRecordedKeys] = useState<Set<string>>(new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showManual, setShowManual] = useState(false);
  const [error, setError] = useState("");

  function record(t: Transfer) {
    const key = `${t.from}-${t.to}-${t.amountMinor}`;
    setPendingKey(key);
    setError("");
    startTransition(async () => {
      const result = await submitSettlementOffline(tripId, homeCurrency, {
        fromMember: t.from,
        toMember: t.to,
        amountMinor: t.amountMinor,
      });
      if (result.ok) setRecordedKeys((prev) => new Set(prev).add(key));
      else setError(result.error ?? "Something went wrong.");
    });
  }

  if (transfers.length === 0 && !showManual) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-zinc-500">Everyone&apos;s settled up.</p>
        <button type="button" onClick={() => setShowManual(true)} className="self-start text-sm text-teal-700 dark:text-teal-400">
          Record a payment
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {transfers.map((t) => {
          const key = `${t.from}-${t.to}-${t.amountMinor}`;
          const done = recordedKeys.has(key);
          return (
            <li
              key={key}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <span className="text-sm">
                <strong>{nameOf(t.from)}</strong> owes <strong>{nameOf(t.to)}</strong>{" "}
                {formatMoney(t.amountMinor, homeCurrency)}
              </span>
              <button
                type="button"
                disabled={done || (isPending && pendingKey === key)}
                onClick={() => record(t)}
                className="rounded-lg bg-teal-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {done ? "Recorded" : isPending && pendingKey === key ? "Recording…" : "Record payment"}
              </button>
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {!showManual ? (
        <button type="button" onClick={() => setShowManual(true)} className="self-start text-sm text-teal-700 dark:text-teal-400">
          Record a different payment
        </button>
      ) : (
        <ManualSettlementForm tripId={tripId} members={members} homeCurrency={homeCurrency} onClose={() => setShowManual(false)} />
      )}
    </div>
  );
}

function ManualSettlementForm({
  tripId,
  members,
  homeCurrency,
  onClose,
}: {
  tripId: string;
  members: Member[];
  homeCurrency: string;
  onClose: () => void;
}) {
  const [from, setFrom] = useState(members[0]?.id ?? "");
  const [to, setTo] = useState(members[1]?.id ?? "");
  const [amountStr, setAmountStr] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex gap-2">
        <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 flex-1 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
        <span className="self-center text-xs text-zinc-500">paid</span>
        <select value={to} onChange={(e) => setTo(e.target.value)} className="h-10 flex-1 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name}
            </option>
          ))}
        </select>
      </div>
      <input
        value={amountStr}
        onChange={(e) => setAmountStr(e.target.value)}
        inputMode="decimal"
        placeholder={`Amount in ${homeCurrency}`}
        className="h-10 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onClose} className="h-10 flex-1 rounded-lg border border-zinc-300 text-sm dark:border-zinc-700">
          Cancel
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            const amountMinor = parseMoneyInput(amountStr, homeCurrency);
            if (from === to) return setError("Pick two different people.");
            if (!amountMinor || amountMinor <= 0) return setError("Enter an amount.");
            setError("");
            startTransition(async () => {
              const result = await submitSettlementOffline(tripId, homeCurrency, { fromMember: from, toMember: to, amountMinor });
              if (result.ok) onClose();
              else setError(result.error ?? "Something went wrong.");
            });
          }}
          className="h-10 flex-1 rounded-lg bg-teal-700 text-sm font-medium text-white disabled:opacity-60"
        >
          {isPending ? "Saving…" : "Record"}
        </button>
      </div>
    </div>
  );
}
