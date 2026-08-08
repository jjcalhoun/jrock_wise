import { describe, it, expect } from "vitest";
import { ledger } from "@/lib/commitments/ledger";
import type { Commitment } from "@/lib/commitments/types";
import type { Transaction } from "@/lib/types";

const c = (o: Partial<Commitment> & { id: string }) => ({
  user_id: "u", series_id: o.id, period: "2026-08", seq: 0, name: "x",
  kind: "bill", amount: -1, interval: 1, frequency: "monthly",
  series_ended: false, skipped: false, variable: false, auto_confirm: false,
  created_at: "", updated_at: "", ...o,
}) as Commitment;
const t = (o: Partial<Transaction> & { id: string }) => ({
  user_id: "u", account_id: "chk", date: "2026-08-05", amount: 0,
  type: "expense", source: "sync", reviewed: true, created_at: "", updated_at: "", ...o,
}) as Transaction;

describe("the SQL mirror in scripts/ledger-explain.sql", () => {
  it("agrees with the TS ledger on the worked example", () => {
    const led = ledger(
      [
        c({ id: "c1", kind: "income", amount: 5000, due_hint: "2026-08-01" }),
        c({ id: "c2", kind: "bill", amount: -200 }),
        c({ id: "c3", kind: "cc_payment", amount: -300 }),
      ],
      [
        t({ id: "t1", amount: 5000, type: "income", commitment_id: "c1" }),
        t({ id: "t2", amount: -150, splits: [{ id: "s1", user_id: "u", transaction_id: "t2", category_id: "k", bucket: "wants", amount: -150, created_at: "" }] }),
        t({ id: "t3", account_id: "visa", amount: -400, splits: [{ id: "s2", user_id: "u", transaction_id: "t3", category_id: "k", bucket: "wants", amount: -400, created_at: "" }] }),
      ],
      "2026-08",
      { creditAccountIds: new Set(["visa"]), loanAccountIds: new Set(), savingsAccountIds: new Set() },
    );
    expect(led.expectedIncome).toBe(5000);
    expect(led.commitmentsPlanned).toBe(500);
    expect(led.discretionary).toBe(150);   // card spend excluded
    expect(led.freeToSpend).toBe(4350);    // same as the SQL
  });
});
