import { describe, it, expect } from "vitest";
import { findCardGaps } from "./cardGap";
import type { Commitment } from "./types";
import type { Account, Transaction, TransactionSplit } from "@/lib/types";

/* A card being spent on with nothing planned to pay it.
   Free-to-spend counts the purchases now, so the money isn't lost from the
   month — but nothing reserves cash to clear the card, and the debt plan can't
   see a payment that was never planned. Silent by construction, like the
   duplicate-series case: the only way it was ever found was by reading the
   database and asking why a number felt wrong. */

const acct = (id: string, name: string, type: Account["type"]) =>
  ({ id, name, type }) as Account;

const plan = (o: Partial<Commitment>) =>
  ({ kind: "cc_payment", skipped: false, period: "2026-08", ...o }) as Commitment;

const split = (txn: string, amount: number): TransactionSplit =>
  ({ id: `s-${txn}`, transaction_id: txn, amount }) as TransactionSplit;

const t = (o: Partial<Transaction> & { id: string }) =>
  ({ date: "2026-08-05", amount: 0, type: "expense", account_id: "chase", ...o }) as Transaction;

const accounts = [
  acct("chk", "Checking", "checking"),
  acct("chase", "Chase United CC", "credit"),
  acct("iucu", "IUCU CC", "credit"),
];

const buy = (id: string, account_id: string, amount: number) =>
  t({ id, account_id, amount: -amount, splits: [split(id, -amount)] });

describe("findCardGaps", () => {
  it("flags a card with spending and no payment line", () => {
    const gaps = findCardGaps(accounts, [], [buy("a", "chase", 316.44)], "2026-08");
    expect(gaps.map((g) => g.name)).toEqual(["Chase United CC"]);
    expect(gaps[0].spent).toBeCloseTo(316.44, 2);
  });

  it("stays quiet when a plan line aims at that card", () => {
    const gaps = findCardGaps(
      accounts,
      [plan({ transfer_account_id: "chase" })],
      [buy("a", "chase", 316.44)],
      "2026-08",
    );
    expect(gaps).toEqual([]);
  });

  it("does not let one card's payment line cover another", () => {
    // the actual bug: a $300 IUCU line while Chase United had nothing
    const gaps = findCardGaps(
      accounts,
      [plan({ transfer_account_id: "iucu" })],
      [buy("a", "chase", 316.44)],
      "2026-08",
    );
    expect(gaps.map((g) => g.name)).toEqual(["Chase United CC"]);
  });

  it("ignores a card-payment line that names no card", () => {
    // it can't be attributed, so it can't be said to cover anything
    const gaps = findCardGaps(
      accounts,
      [plan({ transfer_account_id: null })],
      [buy("a", "chase", 100)],
      "2026-08",
    );
    expect(gaps).toHaveLength(1);
  });

  it("ignores a skipped plan line", () => {
    const gaps = findCardGaps(
      accounts,
      [plan({ transfer_account_id: "chase", skipped: true })],
      [buy("a", "chase", 100)],
      "2026-08",
    );
    expect(gaps).toHaveLength(1);
  });

  it("leaves a dormant card alone — no spending, no balance", () => {
    expect(findCardGaps(accounts, [], [], "2026-08")).toEqual([]);
  });

  it("flags a card with a balance even when nothing was spent this month", () => {
    // you stopped using it but still owe on it, and nothing is paying it down
    const gaps = findCardGaps(accounts, [], [], "2026-08", { chase: -800 });
    expect(gaps.map((g) => g.name)).toEqual(["Chase United CC"]);
    expect(gaps[0].owed).toBe(800);
    expect(gaps[0].spent).toBe(0);
  });

  it("reports what has been paid toward it, unplanned", () => {
    // the $99.44 case: real payments going to a card the plan never mentioned
    const pay = t({ id: "p", account_id: "chase", amount: 99.44, type: "transfer" });
    const gaps = findCardGaps(accounts, [], [buy("a", "chase", 316.44), pay], "2026-08");
    expect(gaps[0].paid).toBeCloseTo(99.44, 2);
  });

  it("ignores other months and other account types", () => {
    const old = buy("old", "chase", 500);
    old.date = "2026-07-05";
    const checking = buy("c", "chk", 200);
    expect(findCardGaps(accounts, [], [old, checking], "2026-08")).toEqual([]);
  });

  it("only counts a plan line from the period being looked at", () => {
    const gaps = findCardGaps(
      accounts,
      [plan({ transfer_account_id: "chase", period: "2026-07" })],
      [buy("a", "chase", 100)],
      "2026-08",
    );
    expect(gaps).toHaveLength(1);
  });

  it("orders by spending, worst first", () => {
    const gaps = findCardGaps(
      accounts,
      [],
      [buy("a", "chase", 100), buy("b", "iucu", 400)],
      "2026-08",
    );
    expect(gaps.map((g) => g.name)).toEqual(["IUCU CC", "Chase United CC"]);
  });
});
