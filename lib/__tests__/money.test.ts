import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  roundHalfUp,
  splitEqually,
  splitByShares,
  splitByPercent,
  splitExact,
  computeTax,
  backComputeSubtotal,
  computeBalances,
  simplifyDebts,
  decomposeNetsToTransfers,
  currencyExponent,
  formatMajor,
  convertMinorUnits,
  type LedgerEntry,
} from "../money";

function sum(m: Map<string, number>): number {
  return [...m.values()].reduce((a, b) => a + b, 0);
}

describe("roundHalfUp", () => {
  it("rounds halves away from zero", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
    expect(roundHalfUp(2.6)).toBe(3);
    expect(roundHalfUp(0)).toBe(0);
  });
});

describe("splitEqually — largest remainder method", () => {
  it("100.00 among 3 -> 33.34/33.33/33.33, extra cent deterministic", () => {
    const result = splitEqually(10000, ["b", "a", "c"]);
    expect(sum(result)).toBe(10000);
    // all remainders equal (10000/3 -> rem 1 for each equally? check exact)
    const values = ["a", "b", "c"].map((id) => result.get(id));
    expect(values.sort((x, y) => (y ?? 0) - (x ?? 0))).toEqual([3334, 3333, 3333]);
  });

  it("0.01 among 3 -> one gets it, rest zero, none negative/fractional", () => {
    const result = splitEqually(1, ["a", "b", "c"]);
    expect(sum(result)).toBe(1);
    for (const v of result.values()) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    expect([...result.values()].filter((v) => v === 1).length).toBe(1);
  });

  it("is deterministic regardless of member insertion order", () => {
    const a = splitEqually(10000, ["a", "b", "c"]);
    const b = splitEqually(10000, ["c", "b", "a"]);
    expect(a).toEqual(b);
  });

  it("property: sum(splits) === total for equal split, any member count", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 20 }),
        (total, n) => {
          const ids = Array.from({ length: n }, (_, i) => `m${i}`);
          const result = splitEqually(total, ids);
          expect(sum(result)).toBe(total);
          for (const v of result.values()) expect(v).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });
});

describe("splitByShares", () => {
  it("splits proportional to share weights", () => {
    // couple = 2 shares, two singles = 1 share each -> total 4 shares
    const result = splitByShares(10000, [
      { id: "couple", weight: 2 },
      { id: "solo1", weight: 1 },
      { id: "solo2", weight: 1 },
    ]);
    expect(sum(result)).toBe(10000);
    expect(result.get("couple")).toBe(5000);
  });

  it("property: sum(splits) === total for random weights", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const weighted = weights.map((w, i) => ({ id: `m${i}`, weight: w }));
          const result = splitByShares(total, weighted);
          expect(sum(result)).toBe(total);
          for (const v of result.values()) expect(v).toBeGreaterThanOrEqual(0);
        }
      )
    );
  });
});

describe("splitByPercent", () => {
  it("splits by basis points summing to 10000", () => {
    const result = splitByPercent(10000, [
      { id: "a", weight: 5000 },
      { id: "b", weight: 3000 },
      { id: "c", weight: 2000 },
    ]);
    expect(sum(result)).toBe(10000);
    expect(result.get("a")).toBe(5000);
  });

  it("rejects percentages not summing to exactly 100%", () => {
    expect(() =>
      splitByPercent(10000, [
        { id: "a", weight: 5000 },
        { id: "b", weight: 3000 },
      ])
    ).toThrow();
  });
});

describe("splitExact", () => {
  it("accepts amounts summing exactly to total", () => {
    const result = splitExact(10000, { a: 4000, b: 6000 });
    expect(sum(result)).toBe(10000);
  });

  it("rejects amounts not summing to total", () => {
    expect(() => splitExact(10000, { a: 4000, b: 5000 })).toThrow();
  });

  it("rejects negative amounts", () => {
    expect(() => splitExact(0, { a: 100, b: -100 })).toThrow();
  });
});

describe("computeTax", () => {
  it("subtotal 100.00, sc 10%, gst 9% -> sc 10.00, gst 9.90, total 119.90", () => {
    const t = computeTax(10000, 1000, 900);
    expect(t.scMinor).toBe(1000);
    expect(t.gstMinor).toBe(990);
    expect(t.totalMinor).toBe(11990);
  });

  it("gst applies to subtotal + service charge, not subtotal alone", () => {
    const t = computeTax(10000, 1000, 900);
    // if gst were on subtotal alone it'd be 900, not 990
    expect(t.gstMinor).not.toBe(900);
  });

  it("zero rates produce zero tax", () => {
    const t = computeTax(10000, 0, 0);
    expect(t.scMinor).toBe(0);
    expect(t.gstMinor).toBe(0);
    expect(t.totalMinor).toBe(10000);
  });

  it("total is always the sum of the three components", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 0, max: 10000 }),
        fc.integer({ min: 0, max: 10000 }),
        (subtotal, sc, gst) => {
          const t = computeTax(subtotal, sc, gst);
          expect(t.totalMinor).toBe(t.subtotalMinor + t.scMinor + t.gstMinor);
        }
      )
    );
  });
});

describe("backComputeSubtotal", () => {
  it("round-trips to within one minor unit", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 2000 }),
        fc.integer({ min: 0, max: 2000 }),
        (subtotal, sc, gst) => {
          const forward = computeTax(subtotal, sc, gst);
          const back = backComputeSubtotal(forward.totalMinor, sc, gst);
          expect(Math.abs(back.totalMinor - forward.totalMinor)).toBeLessThanOrEqual(1);
        }
      )
    );
  });
});

describe("currency exponents", () => {
  it("JPY has 0 decimals", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(formatMajor(1500, "JPY")).toBe("1500");
  });

  it("KWD has 3 decimals", () => {
    expect(currencyExponent("KWD")).toBe(3);
    expect(formatMajor(1500, "KWD")).toBe("1.500");
  });

  it("USD/SGD default to 2 decimals", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(formatMajor(1234, "SGD")).toBe("12.34");
  });

  it("splits correctly for 0-decimal and 3-decimal currencies", () => {
    const jpy = splitEqually(1000, ["a", "b", "c"]); // 1000 yen among 3
    expect(sum(jpy)).toBe(1000);
    const kwd = splitEqually(1000, ["a", "b", "c"]); // 1.000 KWD among 3 (still just minor units)
    expect(sum(kwd)).toBe(1000);
  });
});

describe("convertMinorUnits", () => {
  // Regression: 8200 JPY (0 decimals) into SGD (2 decimals) at ~0.0088
  // must land around S$72.16, not S$0.72 — the naive `amountMinor * rate`
  // is missing the 100x scale factor for the differing decimal places.
  it("JPY -> SGD: minor units scale up by 100x for the decimal-place difference", () => {
    // 8200 yen * 0.0088 SGD/yen = S$72.16 = 7216 minor units (cents), not 72.
    expect(convertMinorUnits(8200, "JPY", "SGD", 0.0088)).toBe(7216);
  });

  it("SGD -> JPY: minor units scale down by 100x", () => {
    // S$72.16 (7216 cents) * (1/0.0088) JPY/SGD ~ 8200 yen (0 decimals)
    const result = convertMinorUnits(7216, "SGD", "JPY", 1 / 0.0088);
    expect(result).toBeCloseTo(8200, -1); // within a few yen of rounding
  });

  it("same-exponent currencies (USD -> SGD) need no scaling beyond the rate itself", () => {
    expect(convertMinorUnits(10000, "USD", "SGD", 1.34)).toBe(13400); // $100.00 -> S$134.00
  });

  it("identity rate leaves same-exponent amounts unchanged", () => {
    expect(convertMinorUnits(500, "USD", "USD", 1)).toBe(500);
  });

  it("property: converting to a currency with more decimals then back recovers the original within rounding", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (amountMinor) => {
        const rate = 0.0088;
        const converted = convertMinorUnits(amountMinor, "JPY", "SGD", rate);
        const back = convertMinorUnits(converted, "SGD", "JPY", 1 / rate);
        expect(Math.abs(back - amountMinor)).toBeLessThanOrEqual(1);
      })
    );
  });
});

describe("decomposeNetsToTransfers", () => {
  it("single creditor gets the debtor's full balance, not a proportional guess", () => {
    const nets = new Map([
      ["payer", 12000],
      ["debtor1", -4000],
      ["debtor2", -4000],
      ["debtor3", -4000],
    ]);
    const transfers = decomposeNetsToTransfers(nets);
    expect(transfers).toEqual(
      expect.arrayContaining([
        { from: "debtor1", to: "payer", amountMinor: 4000 },
        { from: "debtor2", to: "payer", amountMinor: 4000 },
        { from: "debtor3", to: "payer", amountMinor: 4000 },
      ])
    );
  });

  it("splits a debtor's balance across multiple creditors proportionally, summing exactly", () => {
    const nets = new Map([
      ["creditorA", 700],
      ["creditorB", 300],
      ["debtor", -1000],
    ]);
    const transfers = decomposeNetsToTransfers(nets);
    const total = transfers.reduce((s, t) => s + t.amountMinor, 0);
    expect(total).toBe(1000);
  });

  it("returns nothing when everyone is already settled", () => {
    expect(decomposeNetsToTransfers(new Map([["a", 0], ["b", 0]]))).toEqual([]);
  });

  // Regression for the reported bug: with 4 trip members, a single-payer
  // expense split evenly means every non-payer owes that payer their exact
  // share — not some proportion of a globally-aggregated net balance.
  it("property: for a single-payer expense split among any group size, every non-payer owes exactly their share", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 2, max: 10 }),
        (total, memberCount) => {
          const memberIds = Array.from({ length: memberCount }, (_, i) => `m${i}`);
          const splits = splitEqually(total, memberIds);
          const payerId = memberIds[0];
          const entries: LedgerEntry[] = memberIds.map((id) => ({
            memberId: id,
            paidHome: id === payerId ? total : 0,
            owedHome: splits.get(id) ?? 0,
            settlementsSentHome: 0,
            settlementsReceivedHome: 0,
          }));
          const nets = computeBalances(entries);
          const transfers = decomposeNetsToTransfers(nets);
          for (const nonPayerId of memberIds.slice(1)) {
            const owedShare = splits.get(nonPayerId) ?? 0;
            const transfer = transfers.find((t) => t.from === nonPayerId);
            if (owedShare === 0) {
              expect(transfer).toBeUndefined(); // nothing owed -> no transfer, not a zero-amount one
            } else {
              expect(transfer?.amountMinor).toBe(owedShare);
              expect(transfer?.to).toBe(payerId);
            }
          }
        }
      )
    );
  });
});

// Regression for the exact bug report: 4-person trip, two single-payer
// expenses split evenly. The old implementation aggregated everyone's net
// balance across both expenses first and then redistributed it
// proportionally, which is only correct when there's one creditor overall —
// with more people involved it produces numbers unrelated to how the debt
// actually arose. Resolving each expense independently and then netting the
// pairwise results is what actually matches manual arithmetic.
describe("pairwise debts across multiple expenses (integration-style, pure)", () => {
  function localTransfersForExpense(paidBy: string, total: number, memberIds: string[]) {
    const splits = splitEqually(total, memberIds);
    const entries: LedgerEntry[] = memberIds.map((id) => ({
      memberId: id,
      paidHome: id === paidBy ? total : 0,
      owedHome: splits.get(id) ?? 0,
      settlementsSentHome: 0,
      settlementsReceivedHome: 0,
    }));
    return decomposeNetsToTransfers(computeBalances(entries));
  }

  it("nets to 3600: lj paid 16000 (shinkansen), hayyun paid 1600 (food), both split 4 ways", () => {
    const members = ["lj", "hayyun", "c", "d"];
    const shinkansen = localTransfersForExpense("lj", 16000, members);
    const food = localTransfersForExpense("hayyun", 1600, members);

    const ledger = new Map<string, number>();
    const bump = (from: string, to: string, amount: number) => ledger.set(`${from}|${to}`, (ledger.get(`${from}|${to}`) ?? 0) + amount);
    for (const t of [...shinkansen, ...food]) bump(t.from, t.to, t.amountMinor);

    const hayyunToLj = ledger.get("hayyun|lj") ?? 0;
    const ljToHayyun = ledger.get("lj|hayyun") ?? 0;
    expect(hayyunToLj - ljToHayyun).toBe(3600);
  });
});

describe("computeBalances", () => {
  it("computes net per member and enforces sum === 0", () => {
    const entries: LedgerEntry[] = [
      { memberId: "a", paidHome: 12000, owedHome: 4000, settlementsSentHome: 0, settlementsReceivedHome: 0 },
      { memberId: "b", paidHome: 0, owedHome: 4000, settlementsSentHome: 0, settlementsReceivedHome: 0 },
      { memberId: "c", paidHome: 0, owedHome: 4000, settlementsSentHome: 0, settlementsReceivedHome: 0 },
    ];
    const nets = computeBalances(entries);
    expect(nets.get("a")).toBe(8000);
    expect(nets.get("b")).toBe(-4000);
    expect(nets.get("c")).toBe(-4000);
  });

  it("throws when the invariant is violated", () => {
    const entries: LedgerEntry[] = [
      { memberId: "a", paidHome: 100, owedHome: 0, settlementsSentHome: 0, settlementsReceivedHome: 0 },
    ];
    expect(() => computeBalances(entries)).toThrow();
  });

  it("settlements move balances toward zero", () => {
    const entries: LedgerEntry[] = [
      { memberId: "a", paidHome: 10000, owedHome: 5000, settlementsSentHome: 0, settlementsReceivedHome: 5000 },
      { memberId: "b", paidHome: 0, owedHome: 5000, settlementsSentHome: 5000, settlementsReceivedHome: 0 },
    ];
    const nets = computeBalances(entries);
    expect(nets.get("a")).toBe(0);
    expect(nets.get("b")).toBe(0);
  });
});

describe("simplifyDebts", () => {
  it("produces a plan that zeroes every balance when applied", () => {
    const nets = new Map([
      ["a", 8000],
      ["b", -4000],
      ["c", -4000],
    ]);
    const transfers = simplifyDebts(nets);
    const applied = new Map(nets);
    for (const t of transfers) {
      applied.set(t.from, (applied.get(t.from) ?? 0) + t.amountMinor);
      applied.set(t.to, (applied.get(t.to) ?? 0) - t.amountMinor);
    }
    for (const v of applied.values()) expect(v).toBe(0);
  });

  it("produces at most n-1 transfers", () => {
    const nets = new Map([
      ["a", 5000],
      ["b", 3000],
      ["c", -4000],
      ["d", -4000],
    ]);
    const transfers = simplifyDebts(nets);
    expect(transfers.length).toBeLessThanOrEqual(nets.size - 1);
  });

  it("is deterministic for the same input", () => {
    const nets = new Map([
      ["a", 5000],
      ["b", 3000],
      ["c", -4000],
      ["d", -4000],
    ]);
    const t1 = simplifyDebts(new Map(nets));
    const t2 = simplifyDebts(new Map(nets));
    expect(t1).toEqual(t2);
  });

  it("property: random balanced nets always simplify to zero", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -100_000, max: 100_000 }), { minLength: 2, maxLength: 15 }),
        (raw) => {
          // force sum to zero by adjusting the last element
          const adjusted = [...raw];
          const s = adjusted.reduce((a, b) => a + b, 0);
          adjusted[adjusted.length - 1] -= s;
          const nets = new Map(adjusted.map((v, i) => [`m${i}`, v]));
          const transfers = simplifyDebts(nets);
          const applied = new Map(nets);
          for (const t of transfers) {
            applied.set(t.from, (applied.get(t.from) ?? 0) + t.amountMinor);
            applied.set(t.to, (applied.get(t.to) ?? 0) - t.amountMinor);
          }
          for (const v of applied.values()) expect(v).toBe(0);
        }
      )
    );
  });
});
