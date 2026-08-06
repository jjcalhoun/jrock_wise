import { describe, it, expect } from "vitest";
import { cloneForward, latestPerSeries, datesInPeriod } from "./clone";
import type { Commitment } from "./types";

const c = (over: Partial<Commitment> & { series_id: string; period: string }): Commitment => ({
  id: `${over.series_id}-${over.period}-${over.seq ?? 0}`,
  user_id: "u",
  seq: 0,
  name: "Rent",
  kind: "bill",
  amount: -1450,
  account_id: "acc",
  interval: 1,
  frequency: "monthly",
  day_of_month: 1,
  series_ended: false,
  skipped: false,
  variable: false,
  auto_confirm: false,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("latestPerSeries", () => {
  it("picks the newest period, then the highest seq", () => {
    const rows = [
      c({ series_id: "s1", period: "2026-06" }),
      c({ series_id: "s1", period: "2026-07", seq: 0 }),
      c({ series_id: "s1", period: "2026-07", seq: 1 }),
      c({ series_id: "s2", period: "2026-05" }),
    ];
    const out = latestPerSeries(rows).sort((a, b) => a.series_id.localeCompare(b.series_id));
    expect(out).toHaveLength(2);
    expect(out[0].period).toBe("2026-07");
    expect(out[0].seq).toBe(1);
    expect(out[1].period).toBe("2026-05");
  });
});

describe("datesInPeriod", () => {
  it("clamps a day-31 monthly to the month length", () => {
    const prev = c({ series_id: "s", period: "2026-01", day_of_month: 31, due_hint: "2026-01-31" });
    expect(datesInPeriod(prev, "2026-02")).toEqual(["2026-02-28"]);
  });

  it("keeps biweekly phase by stepping from the last occurrence", () => {
    const prev = c({ series_id: "s", period: "2026-06", frequency: "biweekly", day_of_month: null, due_hint: "2026-06-19" });
    // 06-19 + 14 = 07-03, + 14 = 07-17, + 14 = 07-31
    expect(datesInPeriod(prev, "2026-07")).toEqual(["2026-07-03", "2026-07-17", "2026-07-31"]);
  });

  it("gives a three-paycheck month all three lines", () => {
    const prev = c({ series_id: "s", period: "2026-06", frequency: "biweekly", day_of_month: null, due_hint: "2026-06-19" });
    expect(datesInPeriod(prev, "2026-07")).toHaveLength(3);
  });

  it("semimonthly yields both days", () => {
    const prev = c({
      series_id: "s", period: "2026-06", frequency: "semimonthly",
      day_of_month: 15, day_of_month_2: 31, due_hint: "2026-06-30",
    });
    expect(datesInPeriod(prev, "2026-07")).toEqual(["2026-07-15", "2026-07-31"]);
  });

  it("a monthly commitment with no known day still gets a dateless line", () => {
    const prev = c({ series_id: "s", period: "2026-06", day_of_month: null, due_hint: null });
    expect(datesInPeriod(prev, "2026-07")).toEqual([null]);
  });
});

describe("cloneForward", () => {
  it("carries edited amounts forward", () => {
    const prev = c({ series_id: "s", period: "2026-06", name: "Netflix", amount: -17.99, day_of_month: 12 });
    const [draft] = cloneForward([prev], "2026-07");
    expect(draft.amount).toBe(-17.99);
    expect(draft.due_hint).toBe("2026-07-12");
    expect(draft.seq).toBe(0);
  });

  it("skips ended series", () => {
    expect(
      cloneForward([c({ series_id: "s", period: "2026-06", series_ended: true })], "2026-07"),
    ).toEqual([]);
  });

  it("numbers multiple occurrences 0,1,2 within the period", () => {
    const prev = c({ series_id: "s", period: "2026-06", frequency: "biweekly", day_of_month: null, due_hint: "2026-06-19" });
    expect(cloneForward([prev], "2026-07").map((d) => d.seq)).toEqual([0, 1, 2]);
  });

  it("carries the schedule and classification, not the state", () => {
    const prev = c({
      series_id: "s", period: "2026-06", kind: "cc_payment", skipped: true,
      category_id: "cat-1", bucket: "needs", transfer_account_id: "acc-cc", variable: true,
    });
    const [draft] = cloneForward([prev], "2026-07");
    expect(draft.kind).toBe("cc_payment");
    expect(draft.category_id).toBe("cat-1");
    expect(draft.transfer_account_id).toBe("acc-cc");
    expect(draft.variable).toBe(true);
    // skipping one month must not skip the next
    expect("skipped" in draft).toBe(false);
  });

  it("orders by date with dateless lines last", () => {
    const drafts = cloneForward(
      [
        c({ series_id: "a", period: "2026-06", name: "Late", day_of_month: 28, due_hint: "2026-06-28" }),
        c({ series_id: "b", period: "2026-06", name: "Early", day_of_month: 2, due_hint: "2026-06-02" }),
        c({ series_id: "d", period: "2026-06", name: "Dateless", day_of_month: null, due_hint: null }),
      ],
      "2026-07",
    );
    expect(drafts.map((d) => d.name)).toEqual(["Early", "Late", "Dateless"]);
  });
});
