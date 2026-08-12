// Shared logic for turning expense-form input into DB-ready rows. Pure, so
// the add-expense form (client, for live preview) and the server action
// (authoritative) run the exact same computation and can never disagree.

import {
  computeTax,
  backComputeSubtotal,
  splitEqually,
  splitByShares,
  splitByPercent,
  splitExact,
  type TaxBreakdown,
} from "./money";
import type { SplitMode } from "./types";

export interface ExpenseFormInput {
  amountMinor: number; // subtotal if !taxInclusive, else the final receipt total
  applyTax: boolean;
  taxInclusive: boolean;
  scBps: number;
  gstBps: number;
  splitMode: SplitMode;
  participantIds: string[]; // equal mode
  shareWeights: { memberId: string; shares: number }[]; // shares mode
  percentBps: { memberId: string; bps: number }[]; // percent mode
  exactAmounts: { memberId: string; amountMinor: number }[]; // exact mode
  payers: { memberId: string; amountMinor: number }[];
}

export class ExpenseValidationError extends Error {}

export function resolveTax(input: Pick<ExpenseFormInput, "amountMinor" | "applyTax" | "taxInclusive" | "scBps" | "gstBps">): TaxBreakdown {
  const scBps = input.applyTax ? input.scBps : 0;
  const gstBps = input.applyTax ? input.gstBps : 0;

  if (!input.taxInclusive) {
    return computeTax(input.amountMinor, scBps, gstBps);
  }

  // User typed the final total off the receipt. Back-compute a subtotal for
  // display, then force the breakdown to sum to exactly the typed total
  // (backComputeSubtotal's own totalMinor can be off by <=1 minor unit due
  // to rounding the inverse) so the DB's total_is_sum check always holds.
  const approx = backComputeSubtotal(input.amountMinor, scBps, gstBps);
  const gstMinor = input.amountMinor - approx.subtotalMinor - approx.scMinor;
  return {
    subtotalMinor: approx.subtotalMinor,
    scMinor: approx.scMinor,
    gstMinor,
    totalMinor: input.amountMinor,
  };
}

export function resolveSplits(totalMinor: number, input: ExpenseFormInput): Map<string, number> {
  switch (input.splitMode) {
    case "equal": {
      if (input.participantIds.length === 0) throw new ExpenseValidationError("Select at least one person to split with.");
      return splitEqually(totalMinor, input.participantIds);
    }
    case "shares": {
      const active = input.shareWeights.filter((s) => s.shares > 0);
      if (active.length === 0) throw new ExpenseValidationError("Give at least one person a share.");
      return splitByShares(
        totalMinor,
        active.map((s) => ({ id: s.memberId, weight: s.shares }))
      );
    }
    case "percent": {
      try {
        return splitByPercent(
          totalMinor,
          input.percentBps.map((p) => ({ id: p.memberId, weight: p.bps }))
        );
      } catch (e) {
        throw new ExpenseValidationError((e as Error).message);
      }
    }
    case "exact": {
      const amounts: Record<string, number> = {};
      for (const a of input.exactAmounts) amounts[a.memberId] = a.amountMinor;
      try {
        return splitExact(totalMinor, amounts);
      } catch (e) {
        throw new ExpenseValidationError((e as Error).message);
      }
    }
  }
}

export function validatePayers(payers: { memberId: string; amountMinor: number }[], totalMinor: number): void {
  if (payers.length === 0) throw new ExpenseValidationError("Add at least one payer.");
  const sum = payers.reduce((s, p) => s + p.amountMinor, 0);
  if (sum !== totalMinor) {
    throw new ExpenseValidationError(`Payer amounts must add up to the total (off by ${Math.abs(sum - totalMinor)}).`);
  }
  for (const p of payers) {
    if (!Number.isInteger(p.amountMinor) || p.amountMinor <= 0) {
      throw new ExpenseValidationError("Each payer amount must be positive.");
    }
  }
}

export interface ResolvedExpense {
  tax: TaxBreakdown;
  splits: Map<string, number>;
}

export function resolveExpense(input: ExpenseFormInput): ResolvedExpense {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new ExpenseValidationError("Enter an amount greater than zero.");
  }
  const tax = resolveTax(input);
  validatePayers(input.payers, tax.totalMinor);
  const splits = resolveSplits(tax.totalMinor, input);
  return { tax, splits };
}
