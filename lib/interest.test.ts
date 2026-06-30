import { describe, it, expect } from "vitest";
import { monthlyInterest, lastStatement } from "./interest";

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
