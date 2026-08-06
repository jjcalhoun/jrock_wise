import { describe, it, expect } from "vitest";
import { findDuplicateSeries, nameSimilarity, nameTokens } from "./duplicates";
import type { SeriesLike } from "./duplicates";

const s = (over: Partial<SeriesLike> & { id: string; name: string; amount: number }): SeriesLike => ({
  account_id: "acc-chk",
  frequency: "monthly",
  live: true,
  ...over,
});

describe("nameTokens", () => {
  it("strips rails, suffixes and store numbers", () => {
    expect(nameTokens("NETFLIX.COM")).toEqual(["netflix"]);
    expect(nameTokens("Netflix Inc")).toEqual(["netflix"]);
    expect(nameTokens("KROGER #1234")).toEqual(["kroger"]);
    expect(nameTokens("ACH DEBIT - CITY POWER")).toEqual(["city", "power"]);
  });

  it("keeps names that are only noise from collapsing to nothing", () => {
    expect(nameTokens("Payment")).toEqual([]);
    expect(nameSimilarity("Payment", "Payment")).toBe(0); // too generic to link on
  });
});

describe("nameSimilarity", () => {
  it("scores the real-world variants high", () => {
    expect(nameSimilarity("Netflix", "NETFLIX.COM")).toBeGreaterThan(0.9);
    expect(nameSimilarity("Netflix", "Netflix Inc")).toBeGreaterThan(0.9);
    expect(nameSimilarity("City Power & Light", "CITY POWER AND LIGHT")).toBeGreaterThan(0.6);
  });

  it("keeps genuinely different merchants apart", () => {
    expect(nameSimilarity("Netflix", "Spotify")).toBe(0);
    expect(nameSimilarity("Kroger", "Costco")).toBe(0);
  });
});

describe("findDuplicateSeries", () => {
  it("catches the exact case in the data: same bill, two names, days apart", () => {
    const groups = findDuplicateSeries([
      s({ id: "r1", name: "Netflix", amount: -15.99 }),
      s({ id: "r2", name: "NETFLIX.COM", amount: -15.99 }),
      s({ id: "r3", name: "Spotify", amount: -11.99 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["r1", "r2"]);
    expect(groups[0].score).toBeGreaterThan(0.9);
    expect(groups[0].reasons).toContain("same amount");
  });

  it("requires the same account", () => {
    expect(
      findDuplicateSeries([
        s({ id: "a", name: "Netflix", amount: -15.99 }),
        s({ id: "b", name: "Netflix", amount: -15.99, account_id: "acc-cc" }),
      ]),
    ).toEqual([]);
  });

  it("requires the same direction of money", () => {
    expect(
      findDuplicateSeries([
        s({ id: "a", name: "Acme Payroll", amount: 2180 }),
        s({ id: "b", name: "Acme Payroll", amount: -2180 }),
      ]),
    ).toEqual([]);
  });

  it("ignores paused/ended series", () => {
    expect(
      findDuplicateSeries([
        s({ id: "a", name: "Netflix", amount: -15.99 }),
        s({ id: "b", name: "Netflix", amount: -15.99, live: false }),
      ]),
    ).toEqual([]);
  });

  it("separates same-merchant series with genuinely different amounts", () => {
    // two real HELOC payments of different sizes are not duplicates
    expect(
      findDuplicateSeries([
        s({ id: "a", name: "HELOC", amount: -250 }),
        s({ id: "b", name: "HELOC", amount: -900 }),
      ]),
    ).toEqual([]);
  });

  it("still groups when the cadences disagree, and says so", () => {
    const groups = findDuplicateSeries([
      s({ id: "a", name: "Iron Temple Gym", amount: -45 }),
      s({ id: "b", name: "IRON TEMPLE GYM", amount: -45, frequency: "biweekly" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reasons.some((r) => r.startsWith("different cadences"))).toBe(true);
  });

  it("chains three variants into one group", () => {
    const groups = findDuplicateSeries([
      s({ id: "a", name: "Netflix", amount: -15.99 }),
      s({ id: "b", name: "NETFLIX.COM", amount: -16.5 }),
      s({ id: "c", name: "Netflix Inc", amount: -15.99 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
  });

  it("returns nothing on clean data", () => {
    expect(
      findDuplicateSeries([
        s({ id: "a", name: "Rent — Maple St", amount: -1450 }),
        s({ id: "b", name: "City Power", amount: -112 }),
        s({ id: "c", name: "Acme Payroll", amount: 2180 }),
      ]),
    ).toEqual([]);
  });
});

describe("the plan's duplicate prompt", () => {
  it("catches the Ooma case: identical names, days apart", () => {
    // both rules were literally named "Ooma" — detection's name-based dedupe
    // let them through because they came from different creation paths
    const groups = findDuplicateSeries([
      s({ id: "ooma-a", name: "Ooma", amount: -6.81 }),
      s({ id: "ooma-b", name: "Ooma", amount: -6.81 }),
      s({ id: "verizon", name: "Verizon", amount: -73.7 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["ooma-a", "ooma-b"]);
    expect(groups[0].score).toBeGreaterThan(0.95);
  });

  it("stays quiet on a real bill list", () => {
    expect(
      findDuplicateSeries([
        s({ id: "1", name: "Mortgage Payment", amount: -583.57 }),
        s({ id: "2", name: "Department of Education", amount: -221.33 }),
        s({ id: "3", name: "Child support", amount: -206 }),
        s({ id: "4", name: "Ellettsville Uti", amount: -118.64 }),
        s({ id: "5", name: "Certificate of Origin Prog So Eastern", amount: -99.67 }),
        s({ id: "6", name: "Smithville Tele Bill", amount: -74.99 }),
        s({ id: "7", name: "Verizon", amount: -73.7 }),
        s({ id: "8", name: "Duke Energy", amount: -61.96 }),
        s({ id: "9", name: "Vectren Energy", amount: -30.12 }),
        s({ id: "10", name: "Philo.com", amount: -25 }),
        s({ id: "11", name: "YouTube Premium", amount: -15.99 }),
        s({ id: "12", name: "Ooma", amount: -6.81 }),
        s({ id: "13", name: "Link.com", amount: -1.5 }),
      ]),
    ).toEqual([]);
  });
});
