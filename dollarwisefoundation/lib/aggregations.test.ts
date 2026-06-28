import { describe, it, expect } from "vitest";
import {
  rollup,
  accountBalance,
  categoryAverage,
  categoryAverages,
  splitsBalanced,
  monthKey,
} from "./aggregations";
import type { Transaction, Account } from "./types";

/* ---- helpers ---- */
const makeTxn = (overrides: Partial<Transaction>): Transaction => ({
  id: "t1",
  user_id: "u1",
  account_id: "a1",
  date: "2026-06-15",
  amount: -50,
  type: "expense",
  source: "manual",
  reviewed: true,
  created_at: "",
  updated_at: "",
  splits: [],
  ...overrides,
});

const makeAccount = (overrides: Partial<Account>): Account => ({
  id: "a1",
  user_id: "u1",
  name: "Checking",
  type: "checking",
  starting_balance: 1000,
  as_of_date: "2026-01-01",
  apr: 0,
  sort_order: 0,
  created_at: "",
  updated_at: "",
  ...overrides,
});

/* ---- monthKey ---- */
describe("monthKey", () => {
  it("returns YYYY-MM from string", () => {
    expect(monthKey("2026-06-15")).toBe("2026-06");
  });
  it("returns YYYY-MM from Date", () => {
    expect(monthKey(new Date(2026, 5, 24))).toBe("2026-06");
  });
});

/* ---- rollup ---- */
describe("rollup — refund nets against category", () => {
  it("refund claws back from the same category", () => {
    const catId = "groceries";
    const txns: Transaction[] = [
      makeTxn({
        id: "t1",
        type: "expense",
        amount: -100,
        date: "2026-06-10",
        splits: [{ id: "s1", user_id: "u1", transaction_id: "t1", category_id: catId, bucket: "needs", amount: -100, created_at: "" }],
      }),
      makeTxn({
        id: "t2",
        type: "refund",
        amount: 30,
        date: "2026-06-12",
        splits: [{ id: "s2", user_id: "u1", transaction_id: "t2", category_id: catId, bucket: "needs", amount: 30, created_at: "" }],
      }),
    ];
    const { byCat, byBucket, spend } = rollup(txns, "2026-06");
    expect(byCat[catId]).toBe(70);    // 100 expense - 30 refund
    expect(byBucket.needs).toBe(70);
    expect(spend).toBe(70);
  });

  it("refund does not inflate income", () => {
    const txns: Transaction[] = [
      makeTxn({ id: "t1", type: "refund", amount: 20, splits: [{ id: "s1", user_id: "u1", transaction_id: "t1", category_id: "other", bucket: "wants", amount: 20, created_at: "" }] }),
    ];
    const { income, spend } = rollup(txns, "2026-06");
    expect(income).toBe(0);
    expect(spend).toBe(-20); // negative = net gain on spending
  });
});

describe("rollup — transfers excluded from spend/income", () => {
  it("transfer does not appear in spend or income", () => {
    const txns: Transaction[] = [
      makeTxn({ id: "t1", type: "transfer", amount: -500, splits: [] }),
      makeTxn({ id: "t2", type: "transfer", amount: 500, splits: [] }),
    ];
    const { income, spend } = rollup(txns, "2026-06");
    expect(income).toBe(0);
    expect(spend).toBe(0);
  });

  it("income type accumulates to income, not spend", () => {
    const txns: Transaction[] = [
      makeTxn({ id: "t1", type: "income", amount: 2000, splits: [] }),
    ];
    const { income, spend } = rollup(txns, "2026-06");
    expect(income).toBe(2000);
    expect(spend).toBe(0);
  });
});

describe("rollup — month filter", () => {
  it("only counts transactions in the target month", () => {
    const catId = "dining";
    const txns: Transaction[] = [
      makeTxn({ id: "t1", date: "2026-05-10", amount: -40, splits: [{ id: "s1", user_id: "u1", transaction_id: "t1", category_id: catId, bucket: "wants", amount: -40, created_at: "" }] }),
      makeTxn({ id: "t2", date: "2026-06-10", amount: -60, splits: [{ id: "s2", user_id: "u1", transaction_id: "t2", category_id: catId, bucket: "wants", amount: -60, created_at: "" }] }),
    ];
    const { byCat } = rollup(txns, "2026-06");
    expect(byCat[catId]).toBe(60);
    expect(byCat[catId + "_may"]).toBeUndefined();
  });
});

/* ---- accountBalance ---- */
describe("accountBalance — strictly after as_of_date", () => {
  const account = makeAccount({ starting_balance: 1000, as_of_date: "2026-01-15" });

  it("excludes transactions ON the as_of_date", () => {
    const txns = [makeTxn({ date: "2026-01-15", amount: -200 })];
    expect(accountBalance(account, txns)).toBe(1000); // not counted
  });

  it("includes transactions strictly after as_of_date", () => {
    const txns = [makeTxn({ date: "2026-01-16", amount: -200 })];
    expect(accountBalance(account, txns)).toBe(800);
  });

  it("includes multiple transactions after cutoff", () => {
    const txns = [
      makeTxn({ id: "t1", date: "2026-02-01", amount: -200 }),
      makeTxn({ id: "t2", date: "2026-03-05", amount: 500 }),
      makeTxn({ id: "t3", date: "2026-01-15", amount: -9999 }), // on cutoff, excluded
      makeTxn({ id: "t4", date: "2026-01-01", amount: -9999, account_id: "other" }), // wrong acct
    ];
    expect(accountBalance(account, txns)).toBe(1300);
  });

  it("only counts transactions for that specific account", () => {
    const txns = [
      makeTxn({ id: "t1", date: "2026-02-01", amount: -100, account_id: "a1" }),
      makeTxn({ id: "t2", date: "2026-02-01", amount: -500, account_id: "other" }),
    ];
    expect(accountBalance(account, txns)).toBe(900);
  });
});

/* ---- splitsBalanced ---- */
describe("splitsBalanced", () => {
  it("returns true when splits sum to parent amount", () => {
    expect(splitsBalanced(-100, [{ amount: -60 }, { amount: -40 }])).toBe(true);
  });
  it("returns false when splits do not sum correctly", () => {
    expect(splitsBalanced(-100, [{ amount: -60 }, { amount: -30 }])).toBe(false);
  });
  it("returns false for empty splits array", () => {
    expect(splitsBalanced(-50, [])).toBe(false);
  });
  it("works for refund (positive amounts)", () => {
    expect(splitsBalanced(30, [{ amount: 20 }, { amount: 10 }])).toBe(true);
  });
});

/* ---- categoryAverages ---- */
describe("categoryAverages", () => {
  it("averages the N months before the reference month", () => {
    const catId = "dining";
    const txns: Transaction[] = [
      // 3 months before Jun 2026 → Mar, Apr, May
      makeTxn({ id: "t1", date: "2026-03-10", amount: -30, splits: [{ id: "s1", user_id: "u1", transaction_id: "t1", category_id: catId, bucket: "wants", amount: -30, created_at: "" }] }),
      makeTxn({ id: "t2", date: "2026-04-10", amount: -60, splits: [{ id: "s2", user_id: "u1", transaction_id: "t2", category_id: catId, bucket: "wants", amount: -60, created_at: "" }] }),
      makeTxn({ id: "t3", date: "2026-05-10", amount: -90, splits: [{ id: "s3", user_id: "u1", transaction_id: "t3", category_id: catId, bucket: "wants", amount: -90, created_at: "" }] }),
      // current month, should be excluded from averages
      makeTxn({ id: "t4", date: "2026-06-10", amount: -120, splits: [{ id: "s4", user_id: "u1", transaction_id: "t4", category_id: catId, bucket: "wants", amount: -120, created_at: "" }] }),
    ];
    const asOf = new Date(2026, 5, 24); // June 24, 2026
    const { avg3, avg6 } = categoryAverages(txns, catId, asOf);
    expect(avg3).toBeCloseTo(60); // (30+60+90)/3
    expect(avg6).toBeCloseTo(30); // (0+0+0+30+60+90)/6
  });
});
