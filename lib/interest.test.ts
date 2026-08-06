import { describe, it, expect } from "vitest";
import { monthlyInterest, lastStatement, statementsSince } from "./interest";

describe("monthlyInterest", () => {
  it("computes balance * apr / 12, rounded to cents", () => {
    expect(monthlyInterest(1000, 24)).toBe(20); // 1000 * 0.24 / 12
    expect(monthlyInterest(634.6, 19.99)).toBeCloseTo(10.57, 2);
  });
  it("is zero for non-positive owed or apr", () => {
    expect(monthlyInterest(0, 20)).toBe(0);
    expect(monthlyInterest(500, 0)).toBe(0);
    expect(monthlyInterest(-100, 20)).toBe(0);
  });
});

describe("lastStatement", () => {
  it("defaults to the last day of the month", () => {
    expect(lastStatement("2026-06-30", null)).toEqual({ monthKey: "2026-06", postDate: "2026-06-30" });
  });
  it("uses the previous month when this month's statement hasn't arrived", () => {
    expect(lastStatement("2026-06-10", null)).toEqual({ monthKey: "2026-05", postDate: "2026-05-31" });
  });
  it("honors a set statement day", () => {
    expect(lastStatement("2026-06-20", 15)).toEqual({ monthKey: "2026-06", postDate: "2026-06-15" });
    expect(lastStatement("2026-06-10", 15)).toEqual({ monthKey: "2026-05", postDate: "2026-05-15" });
  });
  it("clamps a 31 statement day to the month length", () => {
    expect(lastStatement("2026-02-28", 31)).toEqual({ monthKey: "2026-02", postDate: "2026-02-28" });
  });
});

describe("statementsSince", () => {
  it("skips statements already reflected in the opening balance", () => {
    // CRI: statement day 11, balance entered 7/12 — the 7/11 statement is
    // already baked in, and 8/11 hasn't arrived yet on 8/6.
    expect(statementsSince("2026-08-06", 11, "2026-07-12")).toEqual([]);
    // IUCU CC: statement day 7, same baseline
    expect(statementsSince("2026-08-06", 7, "2026-07-12")).toEqual([]);
  });

  it("posts a statement that falls after the baseline", () => {
    // the mortgage: day 1, baseline 7/12 — 7/1 is already in, 8/1 is not
    expect(statementsSince("2026-08-06", 1, "2026-07-12")).toEqual([
      { monthKey: "2026-08", postDate: "2026-08-01" },
    ]);
    // Earnest: day 21 — 7/21 lands after the baseline
    expect(statementsSince("2026-07-25", 21, "2026-07-12")).toEqual([
      { monthKey: "2026-07", postDate: "2026-07-21" },
    ]);
  });

  it("returns EVERY missed month, oldest first — the gap the old code had", () => {
    // three statements passed since the baseline; all three must post
    expect(statementsSince("2026-10-15", 5, "2026-07-12")).toEqual([
      { monthKey: "2026-08", postDate: "2026-08-05" },
      { monthKey: "2026-09", postDate: "2026-09-05" },
      { monthKey: "2026-10", postDate: "2026-10-05" },
    ]);
  });

  it("clamps a day-31 statement to short months", () => {
    expect(statementsSince("2026-03-05", 31, "2026-01-15").map((s) => s.postDate)).toEqual([
      "2026-01-31",
      "2026-02-28",
    ]);
  });

  it("defaults to month end when no statement day is set", () => {
    expect(statementsSince("2026-08-06", null, "2026-06-15").map((s) => s.postDate)).toEqual([
      "2026-06-30",
      "2026-07-31",
    ]);
  });

  it("returns nothing when no statement has passed yet", () => {
    expect(statementsSince("2026-07-20", 25, "2026-07-12")).toEqual([]);
  });
});
