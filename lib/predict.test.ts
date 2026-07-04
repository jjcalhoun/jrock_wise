import { describe, it, expect } from "vitest";
import { predictMonth } from "./predict";
import type { RecurringRule, Transaction } from "./types";

const rule = (o: Partial<RecurringRule> & { id: string }): RecurringRule => ({
  user_id: "u1",
  name: "Netflix",
  account_id: "chk",
  type: "expense",
  amount: -15.99,
  category_id: "cat_sub",
  bucket: "wants",
  frequency: "monthly",
  day_of_month: 15,
  interval: 1,
  start_date: "2026-01-01",
  auto_review: true,
  active: true,
  created_at: "",
  updated_at: "",
  ...o,
});

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

describe("predictMonth", () => {
  it("predicts an unfilled monthly bill", () => {
    const p = predictMonth([rule({ id: "r1" })], [], "2026-07");
    expect(p.count).toBe(1);
    expect(p.spend).toBeCloseTo(15.99, 2);
    expect(p.byBucket.wants).toBeCloseTo(15.99, 2);
    expect(p.byCat.cat_sub).toBeCloseTo(15.99, 2);
  });

  it("fills once the real charge lands (no double-count)", () => {
    const txns = [tx({ id: "1", date: "2026-07-15", amount: -15.99 })];
    const p = predictMonth([rule({ id: "r1" })], txns, "2026-07");
    expect(p.count).toBe(0);
    expect(p.spend).toBe(0);
  });

  it("fills a matching amount even when the merchant differs slightly", () => {
    const txns = [tx({ id: "1", date: "2026-07-15", amount: -16.2, merchant: "NETFLIX.COM" })];
    const p = predictMonth([rule({ id: "r1" })], txns, "2026-07");
    expect(p.count).toBe(0);
  });

  it("does not fill from an unrelated charge of a different amount", () => {
    const txns = [tx({ id: "1", date: "2026-07-10", amount: -80, merchant: "Groceries" })];
    const p = predictMonth([rule({ id: "r1" })], txns, "2026-07");
    expect(p.count).toBe(1);
  });

  it("predicts income by account + amount, ignoring merchant", () => {
    const r = rule({ id: "r2", type: "income", amount: 2000, name: "Paycheck", category_id: null, bucket: null, day_of_month: 30 });
    const p = predictMonth([r], [], "2026-07");
    expect(p.income).toBeCloseTo(2000, 2);
    const filled = predictMonth([r], [tx({ id: "1", date: "2026-07-30", amount: 2001.34, type: "income", merchant: "ADP" })], "2026-07");
    expect(filled.income).toBe(0);
  });

  it("skips paused rules", () => {
    expect(predictMonth([rule({ id: "r1", active: false })], [], "2026-07").count).toBe(0);
  });

  it("predicts each remaining occurrence of a twice-monthly rule", () => {
    const r = rule({ id: "r3", frequency: "semimonthly", day_of_month: 1, day_of_month_2: 15 });
    // the 1st already landed; the 15th is still to come
    const txns = [tx({ id: "1", date: "2026-07-01", amount: -15.99 })];
    const p = predictMonth([r], txns, "2026-07");
    expect(p.count).toBe(1);
  });
});
