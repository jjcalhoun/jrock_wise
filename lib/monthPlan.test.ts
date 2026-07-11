import { describe, it, expect } from "vitest";
import { buildPlanDraft, isVariableRule, ledger, ruleKind } from "./monthPlan";
import type { Account, MonthPlanItem, RecurringRule, Transaction, TransactionSplit } from "./types";

/* ---------- fixtures ---------- */

const acct = (id: string, type: Account["type"]): Pick<Account, "id" | "type"> => ({ id, type });
const ACCOUNTS = [
  acct("chk", "checking"),
  acct("chk2", "checking"),
  acct("sav", "savings"),
  acct("cc", "credit"),
  acct("loan", "loan"),
];
const CTX = {
  creditAccountIds: new Set(["cc"]),
  loanAccountIds: new Set(["loan"]),
  savingsAccountIds: new Set(["sav"]),
};

const rule = (o: Partial<RecurringRule> & { id: string }): RecurringRule => ({
  user_id: "u1",
  name: "Netflix",
  account_id: "chk",
  type: "expense",
  amount: -15.99,
  category_id: "cat",
  bucket: "wants",
  frequency: "monthly",
  day_of_month: 15,
  interval: 1,
  start_date: "2026-01-01",
  auto_review: true,
  active: true,
  created_at: "",
  updated_at: "",
  ...o,
});

const split = (amount: number): TransactionSplit => ({
  id: "s",
  user_id: "u1",
  transaction_id: "t",
  category_id: "cat",
  bucket: "wants",
  amount,
  created_at: "",
});

const tx = (o: Partial<Transaction> & { id: string; date: string; amount: number }): Transaction => ({
  user_id: "u1",
  account_id: "chk",
  merchant: "Netflix",
  type: "expense",
  source: "sync",
  reviewed: true,
  created_at: "",
  updated_at: "",
  splits: o.type === "expense" || o.type === "refund" || !o.type ? [split(o.amount)] : [],
  ...o,
});

const item = (o: Partial<MonthPlanItem> & { id: string; kind: MonthPlanItem["kind"]; amount: number }): MonthPlanItem => ({
  user_id: "u1",
  plan_id: "p1",
  rule_id: null,
  name: o.id,
  due_date: "2026-08-15",
  variable: false,
  excluded: false,
  created_at: "",
  ...o,
});

/* ---------- drafting ---------- */

describe("ruleKind", () => {
  const byId = Object.fromEntries(ACCOUNTS.map((a) => [a.id, a]));
  it("classifies income / expense", () => {
    expect(ruleKind({ type: "income", transfer_account_id: null }, byId)).toBe("income");
    expect(ruleKind({ type: "expense", transfer_account_id: null }, byId)).toBe("bill");
  });
  it("classifies transfers by destination", () => {
    expect(ruleKind({ type: "transfer", transfer_account_id: "loan" }, byId)).toBe("debt");
    expect(ruleKind({ type: "transfer", transfer_account_id: "cc" }, byId)).toBe("cc_payment");
    expect(ruleKind({ type: "transfer", transfer_account_id: "sav" }, byId)).toBe("savings");
  });
  it("checking-to-checking transfers are not plan items", () => {
    expect(ruleKind({ type: "transfer", transfer_account_id: "chk2" }, byId)).toBeNull();
  });
});

describe("buildPlanDraft", () => {
  it("drafts one item per occurrence, sorted by date", () => {
    const rules = [
      rule({ id: "r1", name: "Rent", amount: -1200, day_of_month: 1, category_id: null }),
      rule({ id: "r2", frequency: "semimonthly", day_of_month: 1, day_of_month_2: 15, name: "Daycare", amount: -300 }),
      rule({ id: "r3", type: "income", name: "Paycheck", amount: 2500, day_of_month: 30, category_id: null, bucket: null }),
    ];
    const draft = buildPlanDraft(rules, "2026-08", ACCOUNTS);
    expect(draft).toHaveLength(4); // rent ×1, daycare ×2, paycheck ×1
    expect(draft.filter((d) => d.rule_id === "r2")).toHaveLength(2);
    expect(draft[0].due_date <= draft[draft.length - 1].due_date).toBe(true);
    const pay = draft.find((d) => d.rule_id === "r3")!;
    expect(pay.kind).toBe("income");
    expect(pay.amount).toBe(2500);
  });

  it("includes debt-payment transfers and skips checking shuffles", () => {
    const rules = [
      rule({ id: "r1", type: "transfer", name: "HELOC payment", amount: -500, transfer_account_id: "loan", category_id: null }),
      rule({ id: "r2", type: "transfer", name: "Move money", amount: -200, transfer_account_id: "chk2", category_id: null }),
    ];
    const draft = buildPlanDraft(rules, "2026-08", ACCOUNTS);
    expect(draft).toHaveLength(1);
    expect(draft[0]).toMatchObject({ kind: "debt", amount: -500 });
  });

  it("skips paused rules and rules with no occurrence this month", () => {
    const rules = [
      rule({ id: "r1", active: false }),
      rule({ id: "r2", start_date: "2026-09-01" }),
    ];
    expect(buildPlanDraft(rules, "2026-08", ACCOUNTS)).toHaveLength(0);
  });

  it("flags variable rules from history spread", () => {
    const history = [
      tx({ id: "1", date: "2026-06-16", amount: -95, merchant: "Duke Energy" }),
      tx({ id: "2", date: "2026-07-15", amount: -160, merchant: "Duke Energy" }),
    ];
    const r = rule({ id: "r1", name: "Duke Energy", amount: -120 });
    expect(isVariableRule(r, history)).toBe(true);
    const draft = buildPlanDraft([r], "2026-08", ACCOUNTS, history);
    expect(draft[0].variable).toBe(true);
  });

  it("stable amounts are not variable", () => {
    const history = [
      tx({ id: "1", date: "2026-06-15", amount: -15.99 }),
      tx({ id: "2", date: "2026-07-15", amount: -15.99 }),
    ];
    expect(isVariableRule(rule({ id: "r1" }), history)).toBe(false);
  });
});

/* ---------- ledger ---------- */

describe("ledger", () => {
  const MONTH = "2026-08";
  const income = item({ id: "i1", kind: "income", amount: 4000 });
  const bill = item({ id: "b1", kind: "bill", amount: -120 });
  const debt = item({ id: "d1", kind: "debt", amount: -500 });

  it("baseline = expected income − commitments; unpaid items count planned", () => {
    const l = ledger([income, bill, debt], [], MONTH, CTX);
    expect(l.baseline).toBe(3380);
    expect(l.freeToSpend).toBe(3380);
    expect(l.items.every((i) => i.status === "expected")).toBe(true);
  });

  it("paid commitment switches to its actual amount", () => {
    const txns = [tx({ id: "1", date: "2026-08-15", amount: -143, plan_item_id: "b1", merchant: "Duke" })];
    const l = ledger([income, bill], txns, MONTH, CTX);
    expect(l.items.find((i) => i.id === "b1")).toMatchObject({ status: "paid", actual: -143, effective: -143 });
    // 4000 − 143 (actual, not 120) — and the linked txn is NOT also discretionary
    expect(l.freeToSpend).toBe(4000 - 143);
    expect(l.discretionary).toBe(0);
  });

  it("paid income uses the actual deposit", () => {
    const txns = [tx({ id: "1", date: "2026-08-01", amount: 4123.5, type: "income", plan_item_id: "i1" })];
    const l = ledger([income, bill], txns, MONTH, CTX);
    expect(l.incomeEffective).toBeCloseTo(4123.5, 2);
    expect(l.freeToSpend).toBeCloseTo(4123.5 - 120, 2);
  });

  it("unlinked income counts as extra income", () => {
    const txns = [tx({ id: "1", date: "2026-08-20", amount: 250, type: "income", merchant: "Refund check" })];
    const l = ledger([income], txns, MONTH, CTX);
    expect(l.extraIncome).toBe(250);
    expect(l.freeToSpend).toBe(4250);
  });

  it("discretionary spend reduces free-to-spend; refunds claw back", () => {
    const txns = [
      tx({ id: "1", date: "2026-08-05", amount: -80, merchant: "Groceries" }),
      tx({ id: "2", date: "2026-08-06", amount: 30, type: "refund", merchant: "Groceries" }),
    ];
    const l = ledger([income], txns, MONTH, CTX);
    expect(l.discretionary).toBe(50);
    expect(l.freeToSpend).toBe(3950);
  });

  it("cash view: CC purchases don't count; the CC payment does", () => {
    const ccItem = item({ id: "c1", kind: "cc_payment", amount: -800 });
    const txns = [
      tx({ id: "1", date: "2026-08-05", amount: -300, account_id: "cc", merchant: "Amazon" }), // purchase — skipped
      tx({ id: "2", date: "2026-08-20", amount: 800, account_id: "cc", type: "transfer", plan_item_id: "c1", transfer_account_id: "chk" }),
    ];
    const l = ledger([income, ccItem], txns, MONTH, CTX);
    expect(l.discretionary).toBe(0);
    expect(l.items.find((i) => i.id === "c1")?.status).toBe("paid");
    expect(l.freeToSpend).toBe(4000 - 800);
  });

  it("extra unplanned debt payment reduces free-to-spend once (destination leg only)", () => {
    const txns = [
      tx({ id: "1", date: "2026-08-22", amount: -250, type: "transfer", transfer_account_id: "loan", transfer_group_id: "g" }),
      tx({ id: "2", date: "2026-08-22", amount: 250, account_id: "loan", type: "transfer", transfer_account_id: "chk", transfer_group_id: "g" }),
    ];
    const l = ledger([income], txns, MONTH, CTX);
    expect(l.discretionary).toBe(250);
    expect(l.freeToSpend).toBe(3750);
  });

  it("checking-to-checking transfers are neutral", () => {
    const txns = [
      tx({ id: "1", date: "2026-08-10", amount: -600, type: "transfer", transfer_account_id: "chk2", transfer_group_id: "g" }),
      tx({ id: "2", date: "2026-08-10", amount: 600, account_id: "chk2", type: "transfer", transfer_account_id: "chk", transfer_group_id: "g" }),
    ];
    const l = ledger([income], txns, MONTH, CTX);
    expect(l.discretionary).toBe(0);
    expect(l.freeToSpend).toBe(4000);
  });

  it("a linked two-sided transfer counts once (prefers the outflow leg)", () => {
    const txns = [
      tx({ id: "1", date: "2026-08-15", amount: -500, type: "transfer", transfer_account_id: "loan", transfer_group_id: "g", plan_item_id: "d1" }),
      tx({ id: "2", date: "2026-08-15", amount: 500, account_id: "loan", type: "transfer", transfer_account_id: "chk", transfer_group_id: "g", plan_item_id: "d1" }),
    ];
    const l = ledger([income, debt], txns, MONTH, CTX);
    expect(l.items.find((i) => i.id === "d1")).toMatchObject({ status: "paid", effective: -500 });
    expect(l.discretionary).toBe(0);
    expect(l.freeToSpend).toBe(3500);
  });

  it("excluded items count nothing even if a transaction links to them", () => {
    const skipped = item({ id: "b2", kind: "bill", amount: -60, excluded: true });
    const l = ledger([income, skipped], [], MONTH, CTX);
    expect(l.commitmentsPlanned).toBe(0);
    expect(l.freeToSpend).toBe(4000);
  });

  it("ignores transactions outside the month", () => {
    const txns = [tx({ id: "1", date: "2026-07-31", amount: -999 })];
    const l = ledger([income], txns, MONTH, CTX);
    expect(l.discretionary).toBe(0);
  });
});
