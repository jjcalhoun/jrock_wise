import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "@/lib/demo/client";
import { linkTransactionToCommitment } from "./link";
import { selectionFor, settlementFor } from "./restore";
import { rankCommitments, orderForDisplay, suggestCommitment } from "./match";
import { ledger } from "./ledger";
import type { Commitment } from "./types";
import type { Transaction } from "@/lib/types";

/* One payment, two weeks — the whole round trip.
 *
 * Reported as: "I can see both selected but can never get both to get
 * covered." Selecting two occurrences appears to work in the picker, and then
 * one of them is not settled afterwards.
 *
 * The picker, the write, the reopen and the plan all have to agree about what
 * a lump payment settles, and each reads a DIFFERENT field to decide: the
 * primary is `transactions.commitment_id`, the extras are
 * `commitments.covered_by`. Any one of them reading only its own half puts the
 * other week back on the board. This walks the entire path.
 */

const db = createDemoClient() as unknown as SupabaseClient;
const U = "cover-user";
const ZELLE = "aaaaaaaa-1111-1111-1111-111111111111";

const week = (id: string, due: string, over: Partial<Commitment> = {}) => ({
  id,
  user_id: U,
  series_id: "cs-series",
  period: due.slice(0, 7),
  seq: Number(due.slice(-2)),
  name: "Child support",
  kind: "bill",
  amount: -206,
  account_id: "chk",
  due_hint: due,
  frequency: "weekly",
  weekday: 5,
  interval: 1,
  series_ended: false,
  skipped: false,
  variable: false,
  auto_confirm: false,
  covered_by: null,
  ...over,
});

async function reset(opts: { skipped24?: boolean } = {}) {
  await db.from("transactions").delete().eq("user_id", U);
  await db.from("commitments").delete().eq("user_id", U);
  await db.from("commitments").insert([
    week("w17", "2026-07-17"),
    week("w24", "2026-07-24", { skipped: opts.skipped24 ?? false }),
    week("w31", "2026-07-31"),
  ]);
  await db.from("transactions").insert({
    id: ZELLE,
    user_id: U,
    account_id: "chk",
    date: "2026-07-17",
    amount: -412,
    description: "Zelle",
    merchant: "Zelle",
    type: "expense",
    source: "manual",
    reviewed: true,
    commitment_id: "w17",
  });
}

const load = async () => {
  const { data: cs } = await db.from("commitments").select("*").eq("user_id", U);
  const { data: ts } = await db.from("transactions").select("*").eq("user_id", U);
  return {
    commitments: (cs ?? []) as unknown as Commitment[],
    transactions: (ts ?? []) as unknown as Transaction[],
  };
};

describe("one payment covering two weeks, end to end", () => {
  beforeEach(() => reset());

  it("settles BOTH weeks after linking", async () => {
    await linkTransactionToCommitment(db, ZELLE, ["w17", "w24"]);
    const { commitments, transactions } = await load();

    const w17 = commitments.find((c) => c.id === "w17")!;
    const w24 = commitments.find((c) => c.id === "w24")!;
    expect(settlementFor(w17, transactions)).not.toBeNull();
    expect(settlementFor(w24, transactions)).not.toBeNull();
    expect(settlementFor(w24, transactions)!.viaCover).toBe(true);
  });

  it("restores both when the editor reopens", async () => {
    await linkTransactionToCommitment(db, ZELLE, ["w17", "w24"]);
    const { commitments, transactions } = await load();
    const txn = transactions.find((t) => t.id === ZELLE)!;
    expect(selectionFor(txn, commitments)).toEqual(["w17", "w24"]);
  });

  it("saving again without touching anything keeps both", async () => {
    // the editor re-links on every save; a round trip must be a no-op
    await linkTransactionToCommitment(db, ZELLE, ["w17", "w24"]);
    const first = await load();
    const txn = first.transactions.find((t) => t.id === ZELLE)!;
    await linkTransactionToCommitment(db, ZELLE, selectionFor(txn, first.commitments));

    const { commitments, transactions } = await load();
    expect(selectionFor(transactions.find((t) => t.id === ZELLE)!, commitments)).toEqual([
      "w17",
      "w24",
    ]);
    expect(settlementFor(commitments.find((c) => c.id === "w24")!, transactions)).not.toBeNull();
  });

  it("counts the money once: $412 total, not $618", async () => {
    await linkTransactionToCommitment(db, ZELLE, ["w17", "w24"]);
    const { commitments, transactions } = await load();
    const led = ledger(commitments, transactions, "2026-07", {
      creditAccountIds: new Set(),
      loanAccountIds: new Set(),
      savingsAccountIds: new Set(),
    });
    // w17 carries the full 412, w24 counts zero, w31 is still expected at 206
    expect(led.commitmentsEffective).toBe(412 + 206);
    expect(led.items.find((i) => i.id === "w24")!.effective).toBe(0);
    expect(led.items.find((i) => i.id === "w24")!.status).toBe("paid");
  });

  it("both weeks are offered by the picker in the first place", async () => {
    const { commitments, transactions } = await load();
    const txn = transactions.find((t) => t.id === ZELLE)!;
    const shown = orderForDisplay(
      rankCommitments(txn, commitments, { linked: transactions }),
    ).map((c) => c.commitment.id);
    expect(shown).toContain("w17");
    expect(shown).toContain("w24");
  });
});

/* The reported dead end. A week unticked earlier in the month could not be
   selected in the picker at all, because scoring filtered skipped lines out —
   so there was no chip to tap, and no way to say a lump payment had covered
   it. Nothing on screen explained why that one week was unreachable. */
describe("a week that was skipped can still be covered", () => {
  beforeEach(() => reset({ skipped24: true }));

  it("is offered by the picker", async () => {
    const { commitments, transactions } = await load();
    const txn = transactions.find((t) => t.id === ZELLE)!;
    const shown = orderForDisplay(
      rankCommitments(txn, commitments, { linked: transactions }),
    ).map((c) => c.commitment.id);
    expect(shown).toContain("w24");
  });

  it("is never PRE-selected, though — skipping was a decision", async () => {
    const { commitments, transactions } = await load();
    const txn = transactions.find((t) => t.id === ZELLE)!;
    const s = suggestCommitment(txn, commitments, { linked: transactions });
    expect(s?.id).not.toBe("w24");
  });

  it("un-skips when a payment covers it, and reads as paid", async () => {
    await linkTransactionToCommitment(db, ZELLE, ["w17", "w24"]);
    const { commitments, transactions } = await load();
    const w24 = commitments.find((c) => c.id === "w24")!;
    expect(w24.skipped).toBe(false);
    expect(w24.covered_by).toBe(ZELLE);
    expect(settlementFor(w24, transactions)!.viaCover).toBe(true);
  });

  it("un-skips the primary too, not just the covered ones", async () => {
    await reset({ skipped24: false });
    await db.from("commitments").update({ skipped: true }).eq("id", "w31");
    await linkTransactionToCommitment(db, ZELLE, ["w31"]);
    const { commitments } = await load();
    expect(commitments.find((c) => c.id === "w31")!.skipped).toBe(false);
  });

  it("still counts the money once after un-skipping", async () => {
    await linkTransactionToCommitment(db, ZELLE, ["w17", "w24"]);
    const { commitments, transactions } = await load();
    const led = ledger(commitments, transactions, "2026-07", {
      creditAccountIds: new Set(),
      loanAccountIds: new Set(),
      savingsAccountIds: new Set(),
    });
    // w24 is back in the plan but covered, so it still contributes nothing
    expect(led.items.find((i) => i.id === "w24")!.effective).toBe(0);
    expect(led.commitmentsEffective).toBe(412 + 206);
  });
});
