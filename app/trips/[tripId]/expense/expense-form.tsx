"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parseMoneyInput, formatMoney } from "@/lib/format";
import { resolveExpense, resolveTax, ExpenseValidationError, type ExpenseFormInput } from "@/lib/expense-builder";
import type { Member, SplitMode } from "@/lib/types";
import { saveExpense, type ExpenseSubmission } from "./actions";
import { submitExpenseOffline } from "@/lib/offline/submit-expense";

const COMMON_CURRENCIES = ["SGD", "USD", "EUR", "GBP", "JPY", "THB", "MYR", "AUD", "IDR", "VND", "KRW", "KWD"];

export interface ExpenseFormInitial {
  id?: string;
  description: string;
  category: string;
  currency: string;
  amountMajor: string; // display string, subtotal or total depending on taxInclusive
  taxInclusive: boolean;
  applyTax: boolean;
  spentAt: string;
  splitMode: SplitMode;
  participantIds: string[];
  shareWeights: Record<string, string>;
  percentInputs: Record<string, string>;
  exactInputs: Record<string, string>;
  payers: Record<string, string>; // memberId -> amount string; single payer = one key
}

export function ExpenseForm({
  tripId,
  members,
  myMemberId,
  tripScBps,
  tripGstBps,
  homeCurrency,
  initial,
}: {
  tripId: string;
  members: Member[];
  myMemberId: string;
  tripScBps: number;
  tripGstBps: number;
  homeCurrency: string;
  initial?: ExpenseFormInitial;
}) {
  const router = useRouter();
  const [description, setDescription] = useState(initial?.description ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? homeCurrency);
  const [amountStr, setAmountStr] = useState(initial?.amountMajor ?? "");
  const [taxInclusive, setTaxInclusive] = useState(initial?.taxInclusive ?? false);
  const [applyTax, setApplyTax] = useState(initial?.applyTax ?? false);
  const [scPercent, setScPercent] = useState((tripScBps / 100).toString());
  const [gstPercent, setGstPercent] = useState((tripGstBps / 100).toString());
  const [spentAt, setSpentAt] = useState(initial?.spentAt ?? new Date().toISOString().slice(0, 10));
  const [splitMode, setSplitMode] = useState<SplitMode>(initial?.splitMode ?? "equal");
  const [participantIds, setParticipantIds] = useState<Set<string>>(
    new Set(initial?.participantIds ?? members.map((m) => m.id))
  );
  const [shareInputs, setShareInputs] = useState<Record<string, string>>(
    initial?.shareWeights ?? Object.fromEntries(members.map((m) => [m.id, "1"]))
  );
  const [percentInputs, setPercentInputs] = useState<Record<string, string>>(initial?.percentInputs ?? {});
  const [exactInputs, setExactInputs] = useState<Record<string, string>>(initial?.exactInputs ?? {});
  const [multiPayer, setMultiPayer] = useState(Object.keys(initial?.payers ?? {}).length > 1);
  const [singlePayerId, setSinglePayerId] = useState(
    Object.keys(initial?.payers ?? { [myMemberId]: "" })[0] ?? myMemberId
  );
  const [payerInputs, setPayerInputs] = useState<Record<string, string>>(initial?.payers ?? {});
  const [saveError, setSaveError] = useState("");
  const [isPending, startTransition] = useTransition();

  const amountMinor = parseMoneyInput(amountStr, currency);

  const formInput: ExpenseFormInput | null = useMemo(() => {
    if (amountMinor === null) return null;

    const payers = multiPayer
      ? members
          .map((m) => ({ memberId: m.id, amountMinor: parseMoneyInput(payerInputs[m.id] ?? "", currency) ?? 0 }))
          .filter((p) => p.amountMinor > 0)
      : [{ memberId: singlePayerId, amountMinor: 0 }]; // placeholder amount, filled below once total is known

    return {
      amountMinor,
      applyTax,
      taxInclusive,
      scBps: Math.round((parseFloat(scPercent) || 0) * 100),
      gstBps: Math.round((parseFloat(gstPercent) || 0) * 100),
      splitMode,
      participantIds: [...participantIds],
      shareWeights: members.map((m) => ({ memberId: m.id, shares: parseInt(shareInputs[m.id] ?? "0", 10) || 0 })),
      percentBps: members.map((m) => ({
        memberId: m.id,
        bps: Math.round((parseFloat(percentInputs[m.id] ?? "0") || 0) * 100),
      })),
      exactAmounts: members.map((m) => ({
        memberId: m.id,
        amountMinor: parseMoneyInput(exactInputs[m.id] ?? "0", currency) ?? 0,
      })),
      payers,
    };
  }, [
    amountMinor,
    applyTax,
    taxInclusive,
    scPercent,
    gstPercent,
    splitMode,
    participantIds,
    shareInputs,
    percentInputs,
    exactInputs,
    multiPayer,
    singlePayerId,
    payerInputs,
    members,
    currency,
  ]);

  // resolveTax has no opinion about payers, so it's safe to call before the
  // single-payer default ("they paid the whole total") is known — computing
  // that default by calling the full validator with a throwaway payer
  // amount doesn't work, since it would reject that throwaway amount for
  // not matching the total it's still trying to discover.
  let preview: { splits: Map<string, number>; totalMinor: number } | null = null;
  let previewError = "";
  if (formInput) {
    try {
      const tax = resolveTax(formInput);
      const finalPayers = multiPayer ? formInput.payers : [{ memberId: singlePayerId, amountMinor: tax.totalMinor }];
      const resolved = resolveExpense({ ...formInput, payers: finalPayers });
      preview = { splits: resolved.splits, totalMinor: resolved.tax.totalMinor };
    } catch (e) {
      previewError = e instanceof ExpenseValidationError ? e.message : "Check the amounts above.";
    }
  }

  function memberName(id: string): string {
    return members.find((m) => m.id === id)?.display_name ?? "?";
  }

  function toggleParticipant(id: string) {
    setParticipantIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    if (!formInput || !preview) return;
    setSaveError("");

    const finalPayers = multiPayer
      ? formInput.payers
      : [{ memberId: singlePayerId, amountMinor: preview.totalMinor }];

    const submission: ExpenseSubmission = {
      ...formInput,
      payers: finalPayers,
      id: initial?.id,
      description,
      category: null,
      currency,
      spentAt,
    };

    startTransition(async () => {
      // Editing an existing (already-synced) expense goes through the server
      // action as before. Creating a new one goes local-first: it resolves
      // and writes entirely client-side, queueing to the offline outbox
      // instead of failing if the network isn't there right now.
      if (initial?.id) {
        const result = await saveExpense(tripId, submission);
        if (!result.ok) {
          setSaveError(result.error ?? "Something went wrong.");
          return;
        }
        router.push(`/trips/${tripId}/expense/${result.id}`);
        return;
      }

      const result = await submitExpenseOffline(tripId, homeCurrency, submission);
      if (!result.ok) {
        setSaveError(result.error ?? "Something went wrong.");
        return;
      }
      router.push(result.queued ? `/trips/${tripId}` : `/trips/${tripId}/expense/${result.id}`);
    });
  }

  const canSave = !!preview && !previewError && description.trim().length > 0 && !isPending;

  return (
    <div className="flex flex-col gap-6 pb-32">
      <div className="flex gap-2">
        <input
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          inputMode="decimal"
          placeholder="0.00"
          className="h-16 flex-1 rounded-xl border border-zinc-300 bg-white px-4 text-3xl font-semibold dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className="h-16 rounded-xl border border-zinc-300 bg-white px-2 text-lg font-medium dark:border-zinc-700 dark:bg-zinc-900"
        >
          {COMMON_CURRENCIES.includes(currency) ? null : <option value={currency}>{currency}</option>}
          {COMMON_CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What was it for?"
        maxLength={140}
        className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
      />

      <input
        type="date"
        value={spentAt}
        onChange={(e) => setSpentAt(e.target.value)}
        className="h-11 rounded-lg border border-zinc-300 bg-white px-3 text-base dark:border-zinc-700 dark:bg-zinc-900"
      />

      {/* --- tax --- */}
      <details className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800" open={applyTax}>
        <summary className="flex cursor-pointer items-center justify-between text-sm font-medium">
          <span>Service charge & GST</span>
          <label className="flex items-center gap-2 text-xs font-normal">
            <input type="checkbox" checked={applyTax} onChange={(e) => setApplyTax(e.target.checked)} />
            {applyTax ? `+${scPercent}% svc, +${gstPercent}% GST` : "off"}
          </label>
        </summary>
        {applyTax && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-zinc-500">Service charge %</span>
                <input
                  value={scPercent}
                  onChange={(e) => setScPercent(e.target.value)}
                  inputMode="decimal"
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-zinc-500">GST %</span>
                <input
                  value={gstPercent}
                  onChange={(e) => setGstPercent(e.target.value)}
                  inputMode="decimal"
                  className="h-10 rounded-lg border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={taxInclusive} onChange={(e) => setTaxInclusive(e.target.checked)} />
              Amount above is the final total (tax already included)
            </label>
          </div>
        )}
      </details>

      {/* --- payer --- */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Paid by</span>
          <button type="button" onClick={() => setMultiPayer((v) => !v)} className="text-xs text-teal-700 dark:text-teal-400">
            {multiPayer ? "single payer" : "split between payers"}
          </button>
        </div>
        {!multiPayer ? (
          <select
            value={singlePayerId}
            onChange={(e) => setSinglePayerId(e.target.value)}
            className="h-11 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === myMemberId ? "Me" : m.display_name}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-sm">{m.display_name}</span>
                <input
                  value={payerInputs[m.id] ?? ""}
                  onChange={(e) => setPayerInputs((p) => ({ ...p, [m.id]: e.target.value }))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-10 flex-1 rounded-lg border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --- split --- */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Split</span>
          <select
            value={splitMode}
            onChange={(e) => setSplitMode(e.target.value as SplitMode)}
            className="h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="equal">Equally</option>
            <option value="exact">Exact amounts</option>
            <option value="shares">Shares</option>
            <option value="percent">Percentage</option>
          </select>
        </div>

        {splitMode === "equal" && (
          <div className="flex flex-col gap-1.5">
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={participantIds.has(m.id)} onChange={() => toggleParticipant(m.id)} />
                {m.display_name}
              </label>
            ))}
          </div>
        )}

        {splitMode === "shares" && (
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-sm">{m.display_name}</span>
                <input
                  value={shareInputs[m.id] ?? ""}
                  onChange={(e) => setShareInputs((p) => ({ ...p, [m.id]: e.target.value }))}
                  inputMode="numeric"
                  placeholder="0"
                  className="h-10 w-20 rounded-lg border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span className="text-xs text-zinc-500">share(s)</span>
              </div>
            ))}
          </div>
        )}

        {splitMode === "percent" && (
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-sm">{m.display_name}</span>
                <input
                  value={percentInputs[m.id] ?? ""}
                  onChange={(e) => setPercentInputs((p) => ({ ...p, [m.id]: e.target.value }))}
                  inputMode="decimal"
                  placeholder="0"
                  className="h-10 w-24 rounded-lg border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
                <span className="text-xs text-zinc-500">%</span>
              </div>
            ))}
          </div>
        )}

        {splitMode === "exact" && (
          <div className="flex flex-col gap-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-sm">{m.display_name}</span>
                <input
                  value={exactInputs[m.id] ?? ""}
                  onChange={(e) => setExactInputs((p) => ({ ...p, [m.id]: e.target.value }))}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-10 flex-1 rounded-lg border border-zinc-300 bg-white px-2 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --- sticky preview + save --- */}
      <div className="fixed bottom-0 left-0 right-0 z-10 border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-2xl flex-col gap-2">
          {preview && !previewError ? (
            <p className="text-xs text-zinc-500">
              {[...preview.splits.entries()]
                .map(([id, amt]) => `${memberName(id)} ${formatMoney(amt, currency)}`)
                .join(" · ")}
            </p>
          ) : (
            <p className="text-xs text-red-600 dark:text-red-400">{previewError || saveError || "Enter an amount."}</p>
          )}
          {saveError && preview && !previewError && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {saveError}
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!canSave}
            className="h-12 rounded-xl bg-teal-700 font-medium text-white disabled:opacity-40"
          >
            {isPending ? "Saving…" : initial?.id ? "Save changes" : "Add expense"}
          </button>
        </div>
      </div>
    </div>
  );
}
