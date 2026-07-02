import { describe, it, expect } from "vitest";
import { occurrences, type Schedule } from "./recurring";

const base: Schedule = { frequency: "monthly", start_date: "2026-01-01" };

describe("occurrences", () => {
  it("monthly on a fixed day", () => {
    expect(
      occurrences({ ...base, frequency: "monthly", day_of_month: 5 }, "2026-01-01", "2026-03-31"),
    ).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
  });

  it("semimonthly on the 15th and last day (31 clamps to month length)", () => {
    expect(
      occurrences(
        { ...base, frequency: "semimonthly", day_of_month: 15, day_of_month_2: 31 },
        "2026-01-01",
        "2026-03-31",
      ),
    ).toEqual([
      "2026-01-15",
      "2026-01-31",
      "2026-02-15",
      "2026-02-28", // Feb clamps
      "2026-03-15",
      "2026-03-31",
    ]);
  });

  it("respects the start_date floor and the [from,to] window", () => {
    expect(
      occurrences({ ...base, frequency: "monthly", day_of_month: 10, start_date: "2026-02-01" }, "2026-01-01", "2026-03-15"),
    ).toEqual(["2026-02-10", "2026-03-10"]);
  });

  it("respects end_date", () => {
    expect(
      occurrences(
        { ...base, frequency: "monthly", day_of_month: 1, end_date: "2026-02-15" },
        "2026-01-01",
        "2026-12-31",
      ),
    ).toEqual(["2026-01-01", "2026-02-01"]);
  });

  it("weekly honors the chosen weekday (first occurrence on/after start)", () => {
    // 2026-01-01 is a Thursday; weekday 5 = Friday → first fires Jan 2
    expect(
      occurrences({ ...base, frequency: "weekly", weekday: 5, start_date: "2026-01-01" }, "2026-01-01", "2026-01-20"),
    ).toEqual(["2026-01-02", "2026-01-09", "2026-01-16"]);
  });

  it("weekly without a weekday falls back to the start date's weekday", () => {
    expect(
      occurrences({ ...base, frequency: "weekly", start_date: "2026-01-01" }, "2026-01-01", "2026-01-15"),
    ).toEqual(["2026-01-01", "2026-01-08", "2026-01-15"]);
  });

  it("biweekly steps 14 days from the anchor", () => {
    expect(
      occurrences({ ...base, frequency: "biweekly", start_date: "2026-01-02" }, "2026-01-01", "2026-02-01"),
    ).toEqual(["2026-01-02", "2026-01-16", "2026-01-30"]);
  });

  it("returns nothing when the window precedes the start", () => {
    expect(
      occurrences({ ...base, frequency: "monthly", day_of_month: 5, start_date: "2026-06-01" }, "2026-01-01", "2026-03-01"),
    ).toEqual([]);
  });
});
