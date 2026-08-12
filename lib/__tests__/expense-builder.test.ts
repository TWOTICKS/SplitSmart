import { describe, it, expect } from "vitest";
import { resolveExpense, resolveTax, ExpenseValidationError, type ExpenseFormInput } from "../expense-builder";

function baseInput(overrides: Partial<ExpenseFormInput> = {}): ExpenseFormInput {
  return {
    amountMinor: 10000,
    applyTax: true,
    taxInclusive: false,
    scBps: 1000,
    gstBps: 900,
    splitMode: "equal",
    participantIds: ["a", "b", "c"],
    shareWeights: [],
    percentBps: [],
    exactAmounts: [],
    payers: [{ memberId: "a", amountMinor: 11990 }],
    ...overrides,
  };
}

describe("resolveExpense", () => {
  it("subtotal-entry mode: 100.00 subtotal, sc 10%, gst 9% -> total 119.90 split equally", () => {
    const result = resolveExpense(baseInput());
    expect(result.tax.totalMinor).toBe(11990);
    expect([...result.splits.values()].reduce((a, b) => a + b, 0)).toBe(11990);
  });

  it("tax-inclusive mode: total entered directly, breakdown sums to it exactly", () => {
    const result = resolveExpense(
      baseInput({ amountMinor: 11990, taxInclusive: true, payers: [{ memberId: "a", amountMinor: 11990 }] })
    );
    expect(result.tax.totalMinor).toBe(11990);
    expect(result.tax.subtotalMinor + result.tax.scMinor + result.tax.gstMinor).toBe(11990);
  });

  it("applyTax false ignores sc/gst even if bps are set", () => {
    const result = resolveExpense(baseInput({ applyTax: false, payers: [{ memberId: "a", amountMinor: 10000 }] }));
    expect(result.tax.totalMinor).toBe(10000);
    expect(result.tax.scMinor).toBe(0);
    expect(result.tax.gstMinor).toBe(0);
  });

  it("rejects payers that don't sum to the total", () => {
    expect(() => resolveExpense(baseInput({ payers: [{ memberId: "a", amountMinor: 100 }] }))).toThrow(
      ExpenseValidationError
    );
  });

  it("shares mode splits proportionally to shares", () => {
    const result = resolveExpense(
      baseInput({
        splitMode: "shares",
        shareWeights: [
          { memberId: "a", shares: 2 },
          { memberId: "b", shares: 1 },
        ],
      })
    );
    const total = [...result.splits.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(result.tax.totalMinor);
    expect(result.splits.get("a")).toBeGreaterThan(result.splits.get("b")!);
  });

  it("percent mode rejects percentages not summing to 100%", () => {
    expect(() =>
      resolveExpense(
        baseInput({
          splitMode: "percent",
          percentBps: [
            { memberId: "a", bps: 4000 },
            { memberId: "b", bps: 4000 },
          ],
        })
      )
    ).toThrow(ExpenseValidationError);
  });

  it("exact mode rejects amounts not summing to the total", () => {
    expect(() =>
      resolveExpense(
        baseInput({
          splitMode: "exact",
          exactAmounts: [
            { memberId: "a", amountMinor: 5000 },
            { memberId: "b", amountMinor: 5000 },
          ],
        })
      )
    ).toThrow(ExpenseValidationError);
  });

  it("rejects a zero amount", () => {
    expect(() => resolveExpense(baseInput({ amountMinor: 0 }))).toThrow(ExpenseValidationError);
  });

  // Regression: the add-expense form defaults a single payer's amount to
  // "the whole total" by calling resolveTax() first (payer-agnostic) and
  // only then building the payers array — it must NOT call resolveExpense
  // with a throwaway payer amount to "discover" the total, since
  // resolveExpense validates payers against that very total and would
  // reject any throwaway value that isn't already correct.
  it("resolveTax lets a single-payer default be computed without tripping payer validation", () => {
    const input = baseInput({
      amountMinor: 16000,
      applyTax: false,
      participantIds: ["a", "b", "c", "d"],
      payers: [],
    });
    const tax = resolveTax(input);
    expect(tax.totalMinor).toBe(16000);

    const withDefaultPayer = { ...input, payers: [{ memberId: "a", amountMinor: tax.totalMinor }] };
    const result = resolveExpense(withDefaultPayer);
    expect(result.tax.totalMinor).toBe(16000);
    expect([...result.splits.values()].reduce((a, b) => a + b, 0)).toBe(16000);
  });
});
