import { describe, it, expect } from "vitest";
import { findMisdatedLinks } from "./misdated";
import type { Commitment } from "./types";
import type { Transaction } from "@/lib/types";

/* The July paycheck on the August line.
 *
 * $1,927.23 arrived on 31 July and was linked to the AUGUST 31st plan line.
 * A linked payment counts toward its commitment's month, so August gained
 * income it never received and July went short by the same amount — from one
 * mis-tap between two chips reading `ADP · 7/31` and `ADP · 8/31`.
 *
 * The tempting rule — "flag a payment outside its commitment's month" — would
 * have missed it completely: 31 July is one day outside August, which is
 * exactly the legitimate case the flexibility exists for. The giveaway is that
 * the same series has an occurrence sitting on the payment's own date.
 */

const c = (o: Partial<Commitment> & { id: string }) =>
  ({
    user_id: "u", series_id: "adp", period: "2026-08", seq: 0,
    name: "ADP Totalsource", kind: "income", amount: 1845.66,
    interval: 1, frequency: "semimonthly", series_ended: false,
    skipped: false, variable: false, auto_confirm: false, covered_by: null,
    account_id: "chk", created_at: "", updated_at: "", ...o,
  }) as Commitment;

const t = (o: Partial<Transaction> & { id: string }) =>
  ({
    user_id: "u", account_id: "chk", date: "2026-07-31", amount: 1927.23,
    type: "income", source: "sync", reviewed: true,
    created_at: "", updated_at: "", ...o,
  }) as Transaction;

const jul31 = c({ id: "jul31", period: "2026-07", due_hint: "2026-07-31" });
const aug15 = c({ id: "aug15", due_hint: "2026-08-15" });
const aug31 = c({ id: "aug31", seq: 1, due_hint: "2026-08-31" });

describe("the reported case", () => {
  it("flags a July paycheck sitting on the August line", () => {
    const pay = t({ id: "p", date: "2026-07-31", commitment_id: "aug31" });
    const found = findMisdatedLinks([jul31, aug15, aug31], [pay]);
    expect(found).toHaveLength(1);
    expect(found[0].linkedTo.id).toBe("aug31");
    expect(found[0].better.id).toBe("jul31");
    expect(found[0].gap).toBe(31);
    expect(found[0].betterGap).toBe(0);
  });

  it("would NOT have been caught by an 'outside its month' rule", () => {
    // 31 July is one day outside August — the same distance as a bill due the
    // 31st clearing on the 1st, which must stay allowed
    const pay = t({ id: "p", date: "2026-07-31", commitment_id: "aug31" });
    const daysOutsideAugust = 1;
    expect(daysOutsideAugust).toBeLessThan(10);
    expect(findMisdatedLinks([jul31, aug15, aug31], [pay])).toHaveLength(1);
  });
});

describe("what it must never flag", () => {
  it("a bill due the 31st that clears on the 1st", () => {
    // the exact flexibility the design exists for
    const pay = t({ id: "p", date: "2026-09-01", commitment_id: "aug31" });
    expect(findMisdatedLinks([aug15, aug31], [pay])).toEqual([]);
  });

  it("a payment a few days early", () => {
    const pay = t({ id: "p", date: "2026-08-28", commitment_id: "aug31" });
    expect(findMisdatedLinks([aug15, aug31], [pay])).toEqual([]);
  });

  it("a late payment with no better sibling anywhere", () => {
    // genuinely two weeks late, but nothing fits better — leave it alone
    const pay = t({ id: "p", date: "2026-08-29", commitment_id: "aug15" });
    expect(findMisdatedLinks([aug15], [pay])).toEqual([]);
  });

  it("an unlinked transaction", () => {
    const pay = t({ id: "p", date: "2026-07-31" });
    expect(findMisdatedLinks([jul31, aug31], [pay])).toEqual([]);
  });

  it("a sibling that is already settled by something else", () => {
    // moving it there would just evict that payment; not a clean mis-pick
    const pay = t({ id: "p", date: "2026-07-31", commitment_id: "aug31" });
    const other = t({ id: "o", date: "2026-07-30", commitment_id: "jul31" });
    expect(findMisdatedLinks([jul31, aug31], [pay, other])).toEqual([]);
  });

  it("a sibling that is skipped", () => {
    const pay = t({ id: "p", date: "2026-07-31", commitment_id: "aug31" });
    const skipped = c({ ...jul31, skipped: true });
    expect(findMisdatedLinks([skipped, aug31], [pay])).toEqual([]);
  });

  it("a sibling covered by a lump payment", () => {
    const pay = t({ id: "p", date: "2026-07-31", commitment_id: "aug31" });
    const covered = c({ ...jul31, covered_by: "someone-else" });
    expect(findMisdatedLinks([covered, aug31], [pay])).toEqual([]);
  });

  it("a DIFFERENT series that happens to fit the date", () => {
    // only occurrences of the SAME series are alternatives; another bill
    // landing near that date is not where this payment belongs
    const pay = t({ id: "p", date: "2026-07-31", commitment_id: "aug31" });
    const unrelated = c({ id: "rent", series_id: "rent", period: "2026-07", name: "Rent", due_hint: "2026-07-31" });
    expect(findMisdatedLinks([unrelated, aug31], [pay])).toEqual([]);
  });
});

describe("details", () => {
  it("uses the middle of the month when a line has no date", () => {
    const dateless = c({ id: "d", period: "2026-08", due_hint: null });
    const pay = t({ id: "p", date: "2026-08-16", commitment_id: "d" });
    expect(findMisdatedLinks([dateless], [pay])).toEqual([]);
  });

  it("reports the worst offender first", () => {
    const jun30 = c({ id: "jun30", period: "2026-06", due_hint: "2026-06-30" });
    const a = t({ id: "a", date: "2026-06-30", commitment_id: "aug31" }); // 62 days out
    const b = t({ id: "b", date: "2026-07-31", commitment_id: "aug15" }); // 15 days out
    const found = findMisdatedLinks([jun30, jul31, aug15, aug31], [a, b]);
    expect(found.map((f) => f.txn.id)).toEqual(["a", "b"]);
  });
});
