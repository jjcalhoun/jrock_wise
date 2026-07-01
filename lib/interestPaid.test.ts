import { describe, it, expect } from "vitest";
import { interestPaid, interestPaidByAccount, isInterestPaid } from "./interestPaid";
import type { Transaction } from "./types";

const t = (o: Partial<Transaction>): Transaction =>
  ({
    id: "x", user_id: "u", account_id: "a", date: "2026-06-15", amount: -10,
    type: "expense", source: "manual", splits: [], created_at: "", updated_at: "",
    ...o,
  }) as Transaction;

describe("isInterestPaid", () => {
  it("matches source='interest'", () => {
    expect(isInterestPaid(t({ source: "interest" }))).toBe(true);
  });
  it("matches an uncategorized interest-described expense (older synced rows)", () => {
    expect(isInterestPaid(t({ source: "sync", description: "INTEREST CHARGE ON PURCHASES" }))).toBe(true);
  });
  it("ignores a normal categorized expense", () => {
    expect(isInterestPaid(t({ source: "sync", description: "Amazon", splits: [{ amount: -10 } as never] }))).toBe(false);
  });
  it("ignores a non-interest uncategorized expense", () => {
    expect(isInterestPaid(t({ source: "sync", description: "ATM Withdrawal" }))).toBe(false);
  });
});

describe("interestPaid", () => {
  const txns = [
    t({ id: "1", account_id: "card", source: "interest", amount: -12.5, date: "2026-06-30" }),
    t({ id: "2", account_id: "loan", source: "interest", amount: -100, date: "2026-06-30" }),
    t({ id: "3", account_id: "card", source: "sync", description: "Interest charge", amount: -8, date: "2026-05-31" }),
    t({ id: "4", account_id: "card", source: "sync", description: "Grocery", amount: -40, date: "2026-06-01", splits: [{ amount: -40 } as never] }),
  ];
  it("sums interest across sources", () => {
    expect(interestPaid(txns)).toBeCloseTo(120.5);
  });
  it("respects the since date", () => {
    expect(interestPaid(txns, "2026-06-01")).toBeCloseTo(112.5);
  });
  it("groups by account", () => {
    const by = interestPaidByAccount(txns);
    expect(by.card).toBeCloseTo(20.5);
    expect(by.loan).toBeCloseTo(100);
  });
});
