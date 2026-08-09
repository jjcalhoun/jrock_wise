import { describe, it, expect } from "vitest";
import { ledger } from "./ledger";
import type { Commitment } from "./types";
import type { Transaction, TransactionSplit } from "@/lib/types";

/* Two readings of a credit card. The spend view counts purchases as you make
   them, ON TOP of everything the cash view already counts — the card payment
   included.

   The first version dropped the payment in the spend view, on the theory that
   the purchases and the payment clearing them are one event seen twice. That
   holds only when the card is paid in full monthly. WHEN A BALANCE IS CARRIED
   they are different money: the payment retires old debt, the purchases create
   new. Dropping the payment made turning the toggle ON raise free-to-spend by
   $83, which is how the mistake surfaced. */

const c = (o: Partial<Commitment> & { id: string }) =>
  ({
    user_id: "u", series_id: o.id, period: "2026-08", seq: 0, name: "x",
    kind: "bill", amount: -1, interval: 1, frequency: "monthly",
    series_ended: false, skipped: false, variable: false, auto_confirm: false,
    created_at: "", updated_at: "", ...o,
  }) as Commitment;

const split = (txn: string, amount: number): TransactionSplit =>
  ({ id: `s-${txn}`, user_id: "u", transaction_id: txn, category_id: "k",
     bucket: "wants", amount, created_at: "" }) as TransactionSplit;

const t = (o: Partial<Transaction> & { id: string }) =>
  ({
    user_id: "u", account_id: "chk", date: "2026-08-05", amount: 0,
    type: "expense", source: "sync", reviewed: true,
    created_at: "", updated_at: "", ...o,
  }) as Transaction;

const ctx = {
  creditAccountIds: new Set(["visa"]),
  loanAccountIds: new Set(["mortgage"]),
  savingsAccountIds: new Set<string>(),
};

/** $1000 income, a $400 card purchase, a $300 card payment planned. */
const income = c({ id: "i", kind: "income", amount: 1000 });
const cardPayment = c({ id: "p", kind: "cc_payment", amount: -300 });
const purchase = t({ id: "buy", account_id: "visa", amount: -400, splits: [split("buy", -400)] });

const run = (commitments: Commitment[], txns: Transaction[], countCardPurchases: boolean) =>
  ledger(commitments, txns, "2026-08", ctx, { countCardPurchases });

describe("the toggle only ever adds the purchases", () => {
  it("cash view counts the payment and not the purchase", () => {
    const led = run([income, cardPayment], [purchase], false);
    expect(led.discretionary).toBe(0);
    expect(led.commitmentsEffective).toBe(300);
    expect(led.freeToSpend).toBe(700);
  });

  it("spend view counts the purchase AND keeps the payment", () => {
    // carrying a balance: $400 of new debt and $300 of paydown are both real
    // claims on this month's income
    const led = run([income, cardPayment], [purchase], true);
    expect(led.discretionary).toBe(400);
    expect(led.commitmentsEffective).toBe(300);
    expect(led.freeToSpend).toBe(300);
  });

  it("turning it ON can never RAISE free-to-spend", () => {
    // the bug that started this: dropping the card payment gave back more than
    // the purchases took, so "count card spending" made the number go up
    const cash = run([income, cardPayment], [purchase], false);
    const spend = run([income, cardPayment], [purchase], true);
    expect(spend.freeToSpend).toBeLessThanOrEqual(cash.freeToSpend);
    expect(cash.freeToSpend - spend.freeToSpend).toBe(400); // exactly the purchases
  });

  it("a card payment made as a transfer keeps counting in both views", () => {
    const pay = t({ id: "pay", account_id: "visa", amount: 300, type: "transfer" });
    expect(run([income], [purchase, pay], false).discretionary).toBe(300);
    expect(run([income], [purchase, pay], true).discretionary).toBe(700);
  });
});

describe("the hole the spend view closes", () => {
  it("a card with NO payment line loses its spending in the cash view", () => {
    const led = run([income], [purchase], false);
    expect(led.discretionary).toBe(0); // $400 spent, nothing counted
    expect(led.freeToSpend).toBe(1000);
  });

  it("the spend view counts it regardless of what's planned", () => {
    const led = run([income], [purchase], true);
    expect(led.discretionary).toBe(400);
    expect(led.freeToSpend).toBe(600);
  });
});

describe("what the toggle must NOT change", () => {
  it("loan charges stay out of both views", () => {
    // interest and escrow are consequences of a payment that already counted;
    // counting their splits would double-charge free-to-spend
    const escrow = t({ id: "esc", account_id: "mortgage", amount: -230.91,
                       source: "escrow", splits: [split("esc", -230.91)] });
    expect(run([income], [escrow], false).discretionary).toBe(0);
    expect(run([income], [escrow], true).discretionary).toBe(0);
  });

  it("cash spending counts identically either way", () => {
    const groceries = t({ id: "g", amount: -150, splits: [split("g", -150)] });
    expect(run([income], [groceries], false).freeToSpend).toBe(850);
    expect(run([income], [groceries], true).freeToSpend).toBe(850);
  });

  it("bills, debt and savings are untouched by it", () => {
    const bill = c({ id: "b", kind: "bill", amount: -200 });
    const debt = c({ id: "d", kind: "debt", amount: -500 });
    const save = c({ id: "s", kind: "savings", amount: -100 });
    expect(run([income, bill, debt, save], [], false).commitmentsEffective).toBe(800);
    expect(run([income, bill, debt, save], [], true).commitmentsEffective).toBe(800);
  });

  it("with no cards at all the two views agree exactly", () => {
    const bill = c({ id: "b", kind: "bill", amount: -200 });
    const groceries = t({ id: "g", amount: -150, splits: [split("g", -150)] });
    expect(run([income, bill], [groceries], false).freeToSpend)
      .toBe(run([income, bill], [groceries], true).freeToSpend);
  });

  it("the card payment commitment is untouched by it", () => {
    const led = run([income, cardPayment], [purchase], true);
    const line = led.items.find((i) => i.id === "p");
    expect(line?.effective).toBe(-300);
    expect(line?.amount).toBe(-300);
  });
});
