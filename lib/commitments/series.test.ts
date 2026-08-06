import { describe, it, expect } from "vitest";
import { cloneForward, latestPerSeries } from "./clone";
import type { Commitment } from "./types";

/* Regression cover for the gap that shipped in phase 2: the ledger and the
   plan sheet read `commitments`, but creating a recurring only wrote
   `recurring_rules`. cloneForward can't rescue that — it copies series that
   already exist — so a brand-new rule was invisible everywhere.

   These pin the invariant the creation path has to satisfy: a series is only
   carried forward once it has a first occurrence to carry. */

const c = (over: Partial<Commitment> & { series_id: string; period: string }): Commitment => ({
  id: `${over.series_id}-${over.period}`,
  user_id: "u",
  seq: 0,
  name: "Duke Energy",
  kind: "bill",
  amount: -61.96,
  account_id: "acc-chk",
  interval: 1,
  frequency: "monthly",
  day_of_month: 18,
  series_ended: false,
  skipped: false,
  variable: false,
  auto_confirm: false,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("a series only exists once it has a first occurrence", () => {
  it("cloneForward cannot invent a series from nothing", () => {
    // the bug: a new rule with no commitment yet produces no plan line
    expect(cloneForward([], "2026-09")).toEqual([]);
    expect(latestPerSeries([])).toEqual([]);
  });

  it("once seeded, the series carries itself forward unaided", () => {
    const seeded = [c({ series_id: "new-rule", period: "2026-08", due_hint: "2026-08-18" })];
    const next = cloneForward(latestPerSeries(seeded), "2026-09");
    expect(next).toHaveLength(1);
    expect(next[0].series_id).toBe("new-rule");
    expect(next[0].due_hint).toBe("2026-09-18");
  });

  it("a series ended by pausing its rule stops cloning forward", () => {
    const paused = [c({ series_id: "paused", period: "2026-08", series_ended: true })];
    expect(cloneForward(latestPerSeries(paused), "2026-09")).toEqual([]);
  });

  it("skipping one period does not stop the next", () => {
    const skipped = [c({ series_id: "s", period: "2026-08", skipped: true, due_hint: "2026-08-18" })];
    const next = cloneForward(latestPerSeries(skipped), "2026-09");
    expect(next).toHaveLength(1);
    expect("skipped" in next[0]).toBe(false);
  });
});
