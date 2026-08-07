import { describe, it, expect } from "vitest";
import { buildSeed } from "./seed";
import { ledger } from "@/lib/commitments/ledger";
import type { Commitment } from "@/lib/commitments/types";
import type { Transaction } from "@/lib/types";

describe("demo seed", () => {
  const t = buildSeed("2026-07-15");

  it("is deterministic for a given day", () => {
    expect(JSON.stringify(buildSeed("2026-07-15"))).toBe(JSON.stringify(buildSeed("2026-07-15")));
  });

  it("covers ~3 months of history", () => {
    const dates = t.transactions.map((x) => x.date as string).sort();
    expect(dates[0] <= "2026-04-10").toBe(true);
    expect(dates[dates.length - 1] <= "2026-07-15").toBe(true); // never ahead of today
  });

  it("has a confirmed current-month plan with linked occurrences", () => {
    expect(t.plan_periods).toHaveLength(1);
    expect(t.plan_periods[0].confirmed_at).toBeTruthy();
    expect(t.commitments.length).toBeGreaterThan(6);
    // every rule-generated July row is linked to its commitment
    const gen = t.transactions.filter(
      (x) => x.source === "recurring" && (x.date as string).startsWith("2026-07"),
    );
    expect(gen.length).toBeGreaterThan(0);
    expect(gen.every((x) => !!x.commitment_id)).toBe(true);
  });

  it("commitments are unique per (series, period, seq) — no twins", () => {
    const keys = t.commitments.map((c) => `${c.series_id}|${c.period}|${c.seq}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives the semimonthly-style repeats distinct seq values", () => {
    const bySeries = new Map<string, number[]>();
    for (const c of t.commitments) {
      const arr = bySeries.get(c.series_id as string) ?? [];
      arr.push(c.seq as number);
      bySeries.set(c.series_id as string, arr);
    }
    for (const seqs of bySeries.values()) {
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(Math.min(...seqs)).toBe(0);
    }
  });

  it("leaves a few recent transactions unreviewed for the review demo", () => {
    const unreviewed = t.transactions.filter((x) => !x.reviewed);
    expect(unreviewed.length).toBeGreaterThan(0);
    expect(unreviewed.every((x) => (x.date as string) >= "2026-07-13")).toBe(true);
  });

  it("gives expenses splits and transfers two legs", () => {
    const splitTxns = new Set(t.transaction_splits.map((s) => s.transaction_id));
    const expenses = t.transactions.filter((x) => x.type === "expense" && x.reviewed);
    expect(expenses.every((x) => splitTxns.has(x.id))).toBe(true);
    const transfers = t.transactions.filter((x) => x.type === "transfer");
    const byGroup = new Map<unknown, number>();
    for (const tr of transfers) byGroup.set(tr.transfer_group_id, (byGroup.get(tr.transfer_group_id) ?? 0) + 1);
    expect([...byGroup.values()].every((n) => n === 2)).toBe(true);
  });

  it("the commitments ledger computes a real Free to spend from this seed", () => {
    const led = ledger(
      t.commitments as unknown as Commitment[],
      t.transactions as unknown as Transaction[],
      "2026-07",
      {
        creditAccountIds: new Set(["acc-cc"]),
        loanAccountIds: new Set(["acc-loan"]),
        savingsAccountIds: new Set(["acc-sav"]),
      },
    );
    expect(led.expectedIncome).toBeGreaterThan(0);
    expect(led.commitmentsPlanned).toBeGreaterThan(0);
    // the rule-generated rows link, so some commitments read as paid
    expect(led.items.some((i) => i.status === "paid")).toBe(true);
    expect(Number.isFinite(led.freeToSpend)).toBe(true);
  });
});
