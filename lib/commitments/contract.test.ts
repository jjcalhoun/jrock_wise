import { describe, it, expect } from "vitest";
import { ledger } from "./ledger";
import type { Commitment } from "./types";
import type { Transaction, TransactionSplit } from "@/lib/types";

/* THE CONTRACT.
 *
 * Free to spend = what comes in, minus what is expected to go out.
 *
 * Everything else in this directory is machinery for getting those two totals
 * right. This file states the promise in plain terms and works one realistic
 * month by hand, so a change that quietly breaks it fails here rather than
 * showing up as a number that feels wrong three weeks later.
 *
 * The two rules that make it work:
 *
 *   1. EVERY DOLLAR COUNTS EXACTLY ONCE. A bill counts as its plan until a
 *      payment matches it, then as the payment — never both. A payment that
 *      settles several weeks counts on the week it's linked to and zero on the
 *      rest. A transfer between two of your own accounts counts nowhere.
 *
 *   2. EXPECTED AND ACTUAL ARE THE SAME LINE. An unpaid bill still reduces the
 *      number, from the 1st. Nothing about the month is a surprise on the 28th.
 */

const c = (o: Partial<Commitment> & { id: string }) =>
  ({
    user_id: "u", series_id: o.id, period: "2026-08", seq: 0, name: o.id,
    kind: "bill", amount: 0, interval: 1, frequency: "monthly",
    series_ended: false, skipped: false, variable: false, auto_confirm: false,
    created_at: "", updated_at: "", ...o,
  }) as Commitment;

const sp = (txn: string, amount: number): TransactionSplit =>
  ({ id: `s-${txn}`, user_id: "u", transaction_id: txn, category_id: "k",
     bucket: "needs", amount, created_at: "" }) as TransactionSplit;

const t = (o: Partial<Transaction> & { id: string }) =>
  ({
    user_id: "u", account_id: "chk", date: "2026-08-10", amount: 0,
    type: "expense", source: "sync", reviewed: true,
    created_at: "", updated_at: "", ...o,
  }) as Transaction;

const ctx = {
  creditAccountIds: new Set(["card"]),
  loanAccountIds: new Set(["mortgage"]),
  savingsAccountIds: new Set(["savings"]),
};

const run = (cs: Commitment[], txns: Transaction[]) =>
  ledger(cs, txns, "2026-08", ctx, { countCardPurchases: true });

describe("what comes in, minus what is expected to go out", () => {
  /* One month, worked by hand.
   *
   *   IN     4,000  two paydays of 2,000 — the first arrived, the second hasn't
   *   OUT    1,200  mortgage (paid)
   *            300  card payment (not yet paid)
   *            200  electricity (paid, came in at 210)
   *            100  savings (not yet moved)
   *   SPENT    450  groceries and fuel from checking
   *             80  a card purchase
   *
   *   4,000 − (1,200 + 300 + 210 + 100) − (450 + 80) = 1,660
   */
  const commitments = [
    c({ id: "pay-1", kind: "income", amount: 2000, due_hint: "2026-08-15" }),
    c({ id: "pay-2", kind: "income", amount: 2000, due_hint: "2026-08-31" }),
    c({ id: "mortgage", kind: "debt", amount: -1200, due_hint: "2026-08-01" }),
    c({ id: "card-pmt", kind: "cc_payment", amount: -300, due_hint: "2026-08-08" }),
    c({ id: "power", kind: "bill", amount: -200, due_hint: "2026-08-18", variable: true }),
    c({ id: "save", kind: "savings", amount: -100, due_hint: "2026-08-05" }),
  ];

  const transactions = [
    // the first payday arrived
    t({ id: "in-1", amount: 2000, type: "income", commitment_id: "pay-1" }),
    // mortgage paid, as a two-sided transfer
    t({ id: "mtg-out", amount: -1200, type: "transfer", transfer_account_id: "mortgage",
        transfer_group_id: "g1", commitment_id: "mortgage" }),
    t({ id: "mtg-in", account_id: "mortgage", amount: 1200, type: "transfer",
        transfer_account_id: "chk", transfer_group_id: "g1", commitment_id: "mortgage" }),
    // electricity came in over its estimate
    t({ id: "power-1", amount: -210, commitment_id: "power", splits: [sp("power-1", -210)] }),
    // ordinary spending, nothing planned it
    t({ id: "food", amount: -300, splits: [sp("food", -300)] }),
    t({ id: "fuel", amount: -150, splits: [sp("fuel", -150)] }),
    // one card purchase
    t({ id: "buy", account_id: "card", amount: -80, splits: [sp("buy", -80)] }),
  ];

  const led = run(commitments, transactions);

  it("counts everything expected to come in, arrived or not", () => {
    expect(led.expectedIncome).toBe(4000);
    expect(led.incomeEffective).toBe(4000); // the unpaid payday still counts
    expect(led.extraIncome).toBe(0);
  });

  it("counts a paid bill at what was actually paid, not what was planned", () => {
    const power = led.items.find((i) => i.id === "power");
    expect(power?.amount).toBe(-200); // planned
    expect(power?.effective).toBe(-210); // actual
    expect(power?.status).toBe("paid");
  });

  it("counts an unpaid commitment at its plan, from the 1st", () => {
    const card = led.items.find((i) => i.id === "card-pmt");
    expect(card?.effective).toBe(-300);
    expect(card?.status).toBe("expected");
  });

  it("counts a two-sided transfer once, not twice", () => {
    // both legs are linked to the mortgage; only the outflow counts
    const mtg = led.items.find((i) => i.id === "mortgage");
    expect(mtg?.linked).toHaveLength(2);
    expect(mtg?.effective).toBe(-1200);
  });

  it("adds up: in − out − spent", () => {
    expect(led.commitmentsEffective).toBe(1810); // 1200 + 300 + 210 + 100
    expect(led.discretionary).toBe(530); // 450 cash + 80 card
    expect(led.freeToSpend).toBe(4000 - 1810 - 530);
    expect(led.freeToSpend).toBe(1660);
  });

  it("never counts a planned payment twice once it's paid", () => {
    // The mortgage and the power bill are linked, so they must not ALSO land in
    // discretionary — the single most costly mistake available here. Proved by
    // removing them: what's left is exactly the unplanned spending.
    const unplanned = transactions
      .filter((x) => !x.commitment_id && x.type === "expense")
      .flatMap((x) => x.splits ?? [])
      .reduce((sum, s) => sum + -s.amount, 0);
    expect(unplanned).toBe(530);
    expect(led.discretionary).toBe(unplanned);

    // and the whole month's outgoings account for every dollar exactly once
    expect(led.commitmentsEffective + led.discretionary).toBe(1810 + 530);
  });
});

describe("the promise holds as the month fills in", () => {
  const income = c({ id: "in", kind: "income", amount: 3000 });
  const bill = c({ id: "b", kind: "bill", amount: -400, due_hint: "2026-08-20" });

  it("an empty month reads as income minus the plan", () => {
    expect(run([income, bill], []).freeToSpend).toBe(2600);
  });

  it("paying the bill at its estimate changes nothing", () => {
    // the money was already accounted for; paying it is not news
    const paid = t({ id: "p", amount: -400, commitment_id: "b", splits: [sp("p", -400)] });
    expect(run([income, bill], [paid]).freeToSpend).toBe(2600);
  });

  it("paying MORE than planned takes the difference, and only the difference", () => {
    const paid = t({ id: "p", amount: -450, commitment_id: "b", splits: [sp("p", -450)] });
    expect(run([income, bill], [paid]).freeToSpend).toBe(2550);
  });

  it("skipping a bill gives its money back", () => {
    const skipped = c({ id: "b", kind: "bill", amount: -400, skipped: true });
    expect(run([income, skipped], []).freeToSpend).toBe(3000);
  });

  it("income beyond the plan adds to it", () => {
    const bonus = t({ id: "x", amount: 500, type: "income" });
    expect(run([income, bill], [bonus]).freeToSpend).toBe(3100);
  });

  it("moving money between your own accounts changes nothing", () => {
    // a shuffle is not spending, and this is where naive versions go wrong
    const out = t({ id: "o", amount: -900, type: "transfer", transfer_account_id: "chk2",
                    transfer_group_id: "g" });
    const into = t({ id: "i", account_id: "chk2", amount: 900, type: "transfer",
                     transfer_account_id: "chk", transfer_group_id: "g" });
    expect(run([income, bill], [out, into]).freeToSpend).toBe(2600);
  });
});

describe("where the number depends on YOUR data, not the code", () => {
  it("a bill with no plan line is invisible until it posts", () => {
    // This is the one honest limitation, and it is worth stating plainly: the
    // ledger can only expect what the plan knows about. An unplanned bill
    // doesn't reduce the number on the 1st — it reduces it the day it lands.
    const income = c({ id: "in", kind: "income", amount: 3000 });
    expect(run([income], []).freeToSpend).toBe(3000); // nothing expected

    const surprise = t({ id: "s", amount: -400, splits: [sp("s", -400)] });
    expect(run([income], [surprise]).freeToSpend).toBe(2600); // now it counts
  });
});
