import { describe, it, expect } from "vitest";
import { detectRecurring } from "./recurringDetect";
import type { Transaction } from "./types";

const tx = (o: Partial<Transaction> & { id: string; date: string; amount: number }): Transaction => ({
  user_id: "u1",
  account_id: "chk",
  merchant: "Netflix",
  type: "expense",
  source: "sync",
  reviewed: true,
  created_at: "",
  updated_at: "",
  splits: [],
  ...o,
});

describe("detectRecurring", () => {
  it("detects a monthly charge (3 occurrences, stable amount)", () => {
    const txns = [
      tx({ id: "1", date: "2026-04-15", amount: -15.99 }),
      tx({ id: "2", date: "2026-05-15", amount: -15.99 }),
      tx({ id: "3", date: "2026-06-15", amount: -15.99 }),
    ];
    const [s] = detectRecurring(txns);
    expect(s).toMatchObject({ frequency: "monthly", day_of_month: 15, count: 3, type: "expense" });
    expect(s.amount).toBeCloseTo(-15.99, 2);
  });

  it("needs at least 3 occurrences", () => {
    const txns = [
      tx({ id: "1", date: "2026-05-15", amount: -15.99 }),
      tx({ id: "2", date: "2026-06-15", amount: -15.99 }),
    ];
    expect(detectRecurring(txns)).toHaveLength(0);
  });

  it("rejects when amounts vary beyond tolerance", () => {
    const txns = [
      tx({ id: "1", date: "2026-04-15", amount: -10 }),
      tx({ id: "2", date: "2026-05-15", amount: -50 }),
      tx({ id: "3", date: "2026-06-15", amount: -12 }),
    ];
    expect(detectRecurring(txns)).toHaveLength(0);
  });

  it("detects a weekly cadence", () => {
    const txns = [
      tx({ id: "1", date: "2026-06-01", amount: -12, merchant: "Coffee" }),
      tx({ id: "2", date: "2026-06-08", amount: -12, merchant: "Coffee" }),
      tx({ id: "3", date: "2026-06-15", amount: -12, merchant: "Coffee" }),
    ];
    const [s] = detectRecurring(txns);
    expect(s.frequency).toBe("weekly");
    expect(s.weekday).toBe(1); // Mondays
  });

  it("skips a group already covered by an active rule", () => {
    const txns = [
      tx({ id: "1", date: "2026-04-15", amount: -15.99 }),
      tx({ id: "2", date: "2026-05-15", amount: -15.99 }),
      tx({ id: "3", date: "2026-06-15", amount: -15.99 }),
    ];
    const rules = [{ account_id: "chk", type: "expense", name: "Netflix", active: true }];
    expect(detectRecurring(txns, rules)).toHaveLength(0);
  });

  it("skips a dismissed signature", () => {
    const txns = [
      tx({ id: "1", date: "2026-04-15", amount: -15.99 }),
      tx({ id: "2", date: "2026-05-15", amount: -15.99 }),
      tx({ id: "3", date: "2026-06-15", amount: -15.99 }),
    ];
    const first = detectRecurring(txns)[0];
    expect(detectRecurring(txns, [], new Set([first.signature]))).toHaveLength(0);
  });

  it("ignores our own recurring-generated rows", () => {
    const txns = [
      tx({ id: "1", date: "2026-04-15", amount: -15.99, source: "recurring" }),
      tx({ id: "2", date: "2026-05-15", amount: -15.99, source: "recurring" }),
      tx({ id: "3", date: "2026-06-15", amount: -15.99, source: "recurring" }),
    ];
    expect(detectRecurring(txns)).toHaveLength(0);
  });

  it("detects recurring income too", () => {
    const txns = [
      tx({ id: "1", date: "2026-04-30", amount: 2000, merchant: "ACME Payroll", type: "income" }),
      tx({ id: "2", date: "2026-05-30", amount: 2000, merchant: "ACME Payroll", type: "income" }),
      tx({ id: "3", date: "2026-06-30", amount: 2000, merchant: "ACME Payroll", type: "income" }),
    ];
    const [s] = detectRecurring(txns);
    expect(s).toMatchObject({ type: "income", frequency: "monthly" });
    expect(s.amount).toBeCloseTo(2000, 2);
  });
});
