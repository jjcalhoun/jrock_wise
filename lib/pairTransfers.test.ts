import { describe, it, expect } from "vitest";
import { pairTransfers, type PairItem } from "./pairTransfers";

const item = (o: Partial<PairItem> & { id: string }): PairItem => ({
  accountId: "checking",
  date: "2026-06-15",
  amount: 0,
  type: "expense",
  ...o,
});

describe("pairTransfers", () => {
  it("pairs a card payment (transfer) with the matching checking debit (expense)", () => {
    const pairs = pairTransfers([
      item({ id: "card", accountId: "card", amount: 200, type: "transfer", date: "2026-06-15" }),
      item({ id: "chk", accountId: "checking", amount: -200, type: "expense", date: "2026-06-16" }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(new Set([pairs[0].a.id, pairs[0].b.id])).toEqual(new Set(["card", "chk"]));
  });

  it("does not swallow an income deposit that matches a payment amount", () => {
    // A card payment (transfer) of 900 and a same-week paycheck of 900 must NOT pair.
    const pairs = pairTransfers([
      item({ id: "card", accountId: "card", amount: -900, type: "transfer", date: "2026-06-30" }),
      item({ id: "paycheck", accountId: "checking", amount: 900, type: "income", date: "2026-06-30" }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("does not pair two unrelated equal expenses (no transfer anchor)", () => {
    const pairs = pairTransfers([
      item({ id: "a", accountId: "checking", amount: -50, type: "expense" }),
      item({ id: "b", accountId: "savings", amount: 50, type: "income" }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("respects the date window", () => {
    const pairs = pairTransfers([
      item({ id: "card", accountId: "card", amount: 100, type: "transfer", date: "2026-06-01" }),
      item({ id: "chk", accountId: "checking", amount: -100, type: "expense", date: "2026-06-20" }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("does not pair same-account rows", () => {
    const pairs = pairTransfers([
      item({ id: "a", accountId: "card", amount: 100, type: "transfer" }),
      item({ id: "b", accountId: "card", amount: -100, type: "expense" }),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it("picks the nearest-dated counterpart", () => {
    const pairs = pairTransfers([
      item({ id: "card", accountId: "card", amount: 75, type: "transfer", date: "2026-06-15" }),
      item({ id: "far", accountId: "checking", amount: -75, type: "expense", date: "2026-06-19" }),
      item({ id: "near", accountId: "checking", amount: -75, type: "expense", date: "2026-06-15" }),
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].b.id).toBe("near");
  });
});
