import { describe, it, expect } from "vitest";
import {
  occurrencesInPeriod,
  planSeriesEdit,
  reviewKind,
  seriesDrafts,
  seriesFrom,
  seriesInputFrom,
  signedAmount,
  type SeriesInput,
} from "./series";
import type { Commitment } from "./types";

/* A series is nothing but its occurrences now. These pin what that has to mean
   when you edit one — above all that an edit never rewrites what a payment
   already settled, which is the invariant the old two-table version couldn't
   hold because the rule and the plan line drifted apart. */

const input = (over: Partial<SeriesInput> = {}): SeriesInput => ({
  name: "Child support",
  kind: "bill",
  amount: 206,
  account_id: "chk",
  frequency: "weekly",
  weekday: 5,
  ...over,
});

const c = (over: Partial<Commitment> & { id: string }): Commitment =>
  ({
    user_id: "u",
    series_id: "s",
    period: "2026-07",
    seq: 0,
    name: "Child support",
    kind: "bill",
    amount: -206,
    account_id: "chk",
    interval: 1,
    frequency: "weekly",
    weekday: 5,
    series_ended: false,
    skipped: false,
    variable: false,
    auto_confirm: false,
    created_at: "",
    updated_at: "",
    ...over,
  }) as Commitment;

describe("signedAmount", () => {
  it("makes income positive and everything else negative", () => {
    expect(signedAmount("income", 4123.5)).toBe(4123.5);
    expect(signedAmount("income", -4123.5)).toBe(4123.5);
    expect(signedAmount("bill", 61.96)).toBe(-61.96);
    expect(signedAmount("debt", -583.57)).toBe(-583.57);
  });
});

describe("occurrencesInPeriod", () => {
  it("covers the WHOLE period, including days already past", () => {
    // a series added on the 20th for a bill due on the 3rd still needs its
    // line, or the payment that already went out has nothing to match
    expect(occurrencesInPeriod(input({ frequency: "monthly", weekday: null, day_of_month: 3 }), "2026-07"))
      .toEqual(["2026-07-03"]);
  });

  it("gives a weekly series every occurrence in the month", () => {
    const dates = occurrencesInPeriod(input(), "2026-07");
    expect(dates).toEqual(["2026-07-03", "2026-07-10", "2026-07-17", "2026-07-24", "2026-07-31"]);
  });

  it("still yields one line when a monthly schedule computes no date", () => {
    // the date was only ever a hint; "sometime in July" is a real expectation
    expect(occurrencesInPeriod(input({ frequency: "monthly", weekday: null, day_of_month: null }), "2026-07"))
      .toEqual([null]);
  });

  it("clamps a 31st to the length of a short month", () => {
    expect(occurrencesInPeriod(input({ frequency: "monthly", weekday: null, day_of_month: 31 }), "2026-02"))
      .toEqual(["2026-02-28"]);
  });
});

describe("seriesDrafts", () => {
  it("numbers occurrences from zero within the period", () => {
    const drafts = seriesDrafts(input(), "series-1", "2026-07");
    expect(drafts.map((d) => d.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(drafts.every((d) => d.series_id === "series-1" && d.period === "2026-07")).toBe(true);
  });

  it("signs the amount by kind, not by what was typed", () => {
    expect(seriesDrafts(input({ kind: "income", amount: 2065 }), "s", "2026-07")[0].amount).toBe(2065);
    expect(seriesDrafts(input(), "s", "2026-07")[0].amount).toBe(-206);
  });
});

describe("planSeriesEdit", () => {
  const july = [
    c({ id: "a", seq: 0, due_hint: "2026-07-03" }),
    c({ id: "b", seq: 1, due_hint: "2026-07-10" }),
    c({ id: "d", seq: 2, due_hint: "2026-07-17" }),
  ];
  const none = () => false;

  it("rebuilds an untouched period from scratch", () => {
    const plan = planSeriesEdit(input({ amount: 220 }), "s", "2026-07", july, none);
    expect(plan.remove).toEqual(["a", "b", "d"]);
    expect(plan.insert).toHaveLength(5);
    expect(plan.insert[0].amount).toBe(-220);
    expect(plan.restamp).toEqual([]);
  });

  it("never removes or re-prices a line a payment already settled", () => {
    const settled = (x: Commitment) => x.id === "a";
    const plan = planSeriesEdit(input({ amount: 220 }), "s", "2026-07", july, settled);
    expect(plan.remove).toEqual(["b", "d"]);
    expect(plan.restamp).toEqual(["a"]);
    // the paid week keeps what it was paid at; the rest get the new figure
    expect(plan.insert.every((d) => d.amount === -220)).toBe(true);
  });

  it("treats a covered line as settled too", () => {
    const covered = [july[0], c({ id: "b", seq: 1, covered_by: "txn-1" })];
    const plan = planSeriesEdit(input(), "s", "2026-07", covered, (x) => !!x.covered_by);
    expect(plan.remove).toEqual(["a"]);
    expect(plan.restamp).toEqual(["b"]);
  });

  it("seq-numbers the replacements after the survivors", () => {
    // the unique constraint is (series, period, seq); a collision here would
    // reject the insert outright
    const settled = (x: Commitment) => x.id === "a" || x.id === "b";
    const plan = planSeriesEdit(input(), "s", "2026-07", july, settled);
    expect(plan.insert.map((d) => d.seq)).toEqual([2, 3, 4]);
    expect(plan.insert.map((d) => d.seq)).not.toContain(0);
  });

  it("shrinking a schedule below what's paid inserts nothing", () => {
    // two weeks paid, then switched to monthly: the paid weeks stand and there
    // is no third line to add — the honest reading of what happened
    const settled = (x: Commitment) => x.id === "a" || x.id === "b";
    const plan = planSeriesEdit(
      input({ frequency: "monthly", weekday: null, day_of_month: 3 }),
      "s",
      "2026-07",
      july,
      settled,
    );
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual(["d"]);
  });

  it("ignores rows from other series and other periods", () => {
    const noise = [
      ...july,
      c({ id: "other", series_id: "s2" }),
      c({ id: "august", period: "2026-08" }),
    ];
    expect(planSeriesEdit(input(), "s", "2026-07", noise, none).remove).toEqual(["a", "b", "d"]);
  });
});

describe("seriesFrom", () => {
  it("keeps the newest occurrence per series — the one carrying the schedule", () => {
    const rows = [
      c({ id: "old", period: "2026-06", seq: 0 }),
      c({ id: "new", period: "2026-07", seq: 1 }),
      c({ id: "mid", period: "2026-07", seq: 0 }),
    ];
    expect(seriesFrom(rows).map((x) => x.id)).toEqual(["new"]);
  });
});

describe("reviewKind", () => {
  const accounts = [
    { id: "loan", type: "loan" },
    { id: "card", type: "credit" },
    { id: "sav", type: "savings" },
    { id: "chk", type: "checking" },
  ];

  it("reads a transfer's meaning off its destination", () => {
    // getting this wrong is how five loans accrued interest with nothing
    // posted against them
    expect(reviewKind("transfer", "loan", accounts)).toBe("debt");
    expect(reviewKind("transfer", "card", accounts)).toBe("cc_payment");
    expect(reviewKind("transfer", "sav", accounts)).toBe("savings");
  });

  it("falls back to a bill for a cash-to-cash shuffle", () => {
    expect(reviewKind("transfer", "chk", accounts)).toBe("bill");
    expect(reviewKind("transfer", null, accounts)).toBe("bill");
  });

  it("passes income through", () => {
    expect(reviewKind("income", null, accounts)).toBe("income");
  });
});

describe("seriesInputFrom", () => {
  it("round-trips a series so a one-field edit changes only that field", () => {
    const original = c({ id: "x", variable: true, day_of_month: 12 });
    const back = seriesInputFrom(original, true);
    expect(back.ended).toBe(true);
    expect(back.amount).toBe(206); // magnitude, re-signed on the way back
    expect(seriesDrafts(back, "s", "2026-07")[0].amount).toBe(-206);
    expect(back.variable).toBe(true);
    expect(back.frequency).toBe("weekly");
  });
});
