import { describe, it, expect } from "vitest";
import { buildSeed } from "./seed";

describe("demo seed", () => {
  const t = buildSeed("2026-07-15");

  it("is deterministic for a given day", () => {
    expect(JSON.stringify(buildSeed("2026-07-15"))).toBe(JSON.stringify(buildSeed("2026-07-15")));
  });

  it("covers ~3 months of history", () => {
    const dates = t.transactions.map((x) => x.date as string).sort();
    expect(dates[0] <= "2026-04-10").toBe(true);
    expect(dates[dates.length - 1] >= "2026-07-15").toBe(true); // pre-posted month
  });

  it("has a confirmed current-month plan with linked occurrences", () => {
    expect(t.month_plans).toHaveLength(1);
    expect(t.month_plans[0].confirmed_at).toBeTruthy();
    const items = t.month_plan_items;
    expect(items.length).toBeGreaterThan(6);
    // every rule-generated July row is linked to a plan item
    const gen = t.transactions.filter(
      (x) => x.source === "recurring" && (x.date as string).startsWith("2026-07"),
    );
    expect(gen.length).toBeGreaterThan(0);
    expect(gen.every((x) => !!x.plan_item_id)).toBe(true);
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
});
