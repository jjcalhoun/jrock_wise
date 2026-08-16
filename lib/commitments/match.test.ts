import { describe, it, expect } from "vitest";
import { rankCommitments, suggestCommitment, orderForDisplay } from "./match";
import type { Commitment } from "./types";
import type { Transaction } from "@/lib/types";

const c = (over: Partial<Commitment> & { id: string; name: string; amount: number }): Commitment => ({
  user_id: "u",
  series_id: `s-${over.id}`,
  period: "2026-07",
  seq: 0,
  kind: "bill",
  account_id: "acc-chk",
  interval: 1,
  frequency: "monthly",
  series_ended: false,
  skipped: false,
  variable: false,
  auto_confirm: false,
  created_at: "",
  updated_at: "",
  ...over,
});

const t = (over: Partial<Transaction> & { amount: number; date: string }): Transaction =>
  ({
    id: "t1",
    user_id: "u",
    account_id: "acc-chk",
    type: "expense",
    reviewed: false,
    source: "sync",
    ...over,
  }) as Transaction;

describe("rankCommitments", () => {
  it("never hides a candidate — everything comes back, scored", () => {
    const items = [
      c({ id: "a", name: "Rent", amount: -1450 }),
      c({ id: "b", name: "Netflix", amount: -15.99 }),
      c({ id: "z", name: "Totally Unrelated", amount: -9999 }),
    ];
    const ranked = rankCommitments(t({ amount: -15.99, date: "2026-07-12", merchant: "NETFLIX.COM" }), items);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].commitment.id).toBe("b");
  });

  it("matches a name variant the old exact-name logic missed", () => {
    const ranked = rankCommitments(
      t({ amount: -15.99, date: "2026-07-12", merchant: "NETFLIX.COM" }),
      [c({ id: "b", name: "Netflix", amount: -15.99, due_hint: "2026-07-12" })],
    );
    expect(ranked[0].score).toBeGreaterThan(0.9);
  });

  it("still ranks the right bill first when it posts two weeks off its hint", () => {
    // the date is a tiebreaker, so drift must not cost the match
    const items = [
      c({ id: "right", name: "City Power", amount: -112, due_hint: "2026-07-17" }),
      c({ id: "wrong", name: "Fiberly Internet", amount: -75, due_hint: "2026-08-01" }),
    ];
    const ranked = rankCommitments(
      t({ amount: -112, date: "2026-08-02", merchant: "CITY POWER" }),
      items,
    );
    expect(ranked[0].commitment.id).toBe("right");
  });

  it("finds the commitment from the FAR leg of a transfer", () => {
    // the payment landing on the card: positive, on the card account.
    // The old sign filter made this unmatchable.
    const items = [
      c({
        id: "cc", name: "Rewards Card payment", amount: -600, kind: "cc_payment",
        account_id: "acc-chk", transfer_account_id: "acc-cc", due_hint: "2026-07-20",
      }),
    ];
    const ranked = rankCommitments(
      t({ amount: 600, date: "2026-07-20", account_id: "acc-cc", type: "transfer", merchant: "Rewards Card payment" }),
      items,
    );
    expect(ranked[0].commitment.id).toBe("cc");
    expect(ranked[0].score).toBeGreaterThan(0.8);
  });

  it("a card charge cannot outrank the right account", () => {
    const items = [
      c({ id: "chk", name: "Gym", amount: -45, account_id: "acc-chk" }),
      c({ id: "card", name: "Gym", amount: -45, account_id: "acc-cc" }),
    ];
    const ranked = rankCommitments(
      t({ amount: -45, date: "2026-07-03", account_id: "acc-cc", merchant: "Gym" }),
      items,
    );
    expect(ranked[0].commitment.id).toBe("card");
  });

  it("surfaces claimed candidates, but ranks them below free ones", () => {
    const items = [
      c({ id: "a", name: "Netflix", amount: -15.99 }),
      c({ id: "b", name: "Netflix", amount: -15.99 }),
    ];
    const ranked = rankCommitments(
      t({ amount: -15.99, date: "2026-07-12", merchant: "Netflix" }),
      items,
      { linked: [t({ id: "other", amount: -15.99, date: "2026-07-10", commitment_id: "a" })] },
    );
    expect(ranked).toHaveLength(2); // claimed one is still offered
    expect(ranked[0].commitment.id).toBe("b");
    expect(ranked[1].claimedBy?.id).toBe("other");
  });

  it("skipped commitments are still OFFERED — you may have paid one anyway", () => {
    // They used to be dropped here, which made a week you had unticked
    // impossible to select and therefore impossible to cover with a lump
    // payment. Nothing on screen explained why that week was unreachable.
    const ranked = rankCommitments(
      t({ amount: -45, date: "2026-07-03", merchant: "Gym" }),
      [c({ id: "a", name: "Gym", amount: -45, skipped: true })],
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].commitment.id).toBe("a");
  });

  it("but a skipped commitment is never PRE-selected", () => {
    // offering it is help; choosing it for you would undo a decision
    const s = suggestCommitment(
      t({ amount: -45, date: "2026-07-03", merchant: "Gym" }),
      [c({ id: "a", name: "Gym", amount: -45, skipped: true })],
    );
    expect(s).toBeNull();
  });

  it("income and outgoing don't cross", () => {
    const ranked = rankCommitments(
      t({ amount: 2180, date: "2026-07-15", type: "income", merchant: "ACME PAYROLL" }),
      [
        c({ id: "pay", name: "Acme Payroll", amount: 2180, kind: "income" }),
        c({ id: "rent", name: "Rent", amount: -2180 }),
      ],
    );
    expect(ranked[0].commitment.id).toBe("pay");
  });
});

describe("suggestCommitment", () => {
  it("pre-selects an obvious match", () => {
    const s = suggestCommitment(
      t({ amount: -15.99, date: "2026-07-12", merchant: "NETFLIX.COM" }),
      [
        c({ id: "b", name: "Netflix", amount: -15.99, due_hint: "2026-07-12" }),
        c({ id: "r", name: "Rent", amount: -1450, due_hint: "2026-07-01" }),
      ],
    );
    expect(s?.id).toBe("b");
  });

  it("declines to guess between two equally good candidates", () => {
    const s = suggestCommitment(
      t({ amount: -15.99, date: "2026-07-12", merchant: "Netflix" }),
      [
        c({ id: "a", name: "Netflix", amount: -15.99, due_hint: "2026-07-12" }),
        c({ id: "b", name: "Netflix", amount: -15.99, due_hint: "2026-07-12" }),
      ],
    );
    expect(s).toBeNull();
  });

  it("declines when nothing is a good match", () => {
    const s = suggestCommitment(
      t({ amount: -83.12, date: "2026-07-12", merchant: "Some Random Shop" }),
      [c({ id: "r", name: "Rent", amount: -1450, due_hint: "2026-07-01" })],
    );
    expect(s).toBeNull();
  });

  it("never suggests a commitment another transaction already claimed", () => {
    const s = suggestCommitment(
      t({ amount: -15.99, date: "2026-07-12", merchant: "Netflix" }),
      [c({ id: "a", name: "Netflix", amount: -15.99, due_hint: "2026-07-12" })],
      { linked: [t({ id: "other", amount: -15.99, date: "2026-07-10", commitment_id: "a" })] },
    );
    expect(s).toBeNull();
  });
});

describe("orderForDisplay", () => {
  it("shows candidates in date order, not score order", () => {
    // the best match is late in the month; it must NOT jump to the front
    const items = [
      c({ id: "late", name: "YouTube Premium", amount: -15.99, due_hint: "2026-08-25" }),
      c({ id: "early", name: "Mortgage Payment", amount: -536, due_hint: "2026-08-01" }),
      c({ id: "mid", name: "Duke Energy", amount: -61.96, due_hint: "2026-08-18" }),
    ];
    const txn = t({ amount: -15.99, date: "2026-08-25", merchant: "YouTube Premium" });
    expect(rankCommitments(txn, items)[0].commitment.id).toBe("late"); // best match
    expect(orderForDisplay(rankCommitments(txn, items)).map((x) => x.commitment.id))
      .toEqual(["early", "mid", "late"]); // but displayed chronologically
  });

  it("keeps repeated occurrences in the order they happen", () => {
    const items = ["2026-08-28", "2026-08-07", "2026-08-21", "2026-08-14"].map((d, i) =>
      c({ id: `cs${i}`, name: "Child support", amount: -206, due_hint: d }),
    );
    const ranked = rankCommitments(t({ amount: -206, date: "2026-08-21", merchant: "Child support" }), items);
    expect(orderForDisplay(ranked).map((x) => x.commitment.due_hint))
      .toEqual(["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28"]);
  });

  it("puts dateless lines last", () => {
    const items = [
      c({ id: "none", name: "Dentist", amount: -220 }),
      c({ id: "dated", name: "Rent", amount: -1450, due_hint: "2026-08-01" }),
    ];
    const ranked = rankCommitments(t({ amount: -220, date: "2026-08-10", merchant: "Dentist" }), items);
    expect(orderForDisplay(ranked).map((x) => x.commitment.id)).toEqual(["dated", "none"]);
  });
});
