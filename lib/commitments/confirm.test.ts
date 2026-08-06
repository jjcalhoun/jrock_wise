import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "@/lib/demo/client";
import { confirmCommitment, unconfirmCommitment } from "./confirm";
import { isAwaitingConfirmation, daysOverdue } from "./due";
import type { Commitment } from "./types";

const db = createDemoClient() as unknown as SupabaseClient;

const c = (over: Partial<Commitment> & { id: string }): Commitment =>
  ({
    user_id: "u",
    series_id: "s",
    period: "2026-08",
    seq: 0,
    name: "HELOC payment",
    kind: "debt",
    amount: -300,
    account_id: "IUCU",
    interval: 1,
    frequency: "monthly",
    series_ended: false,
    skipped: false,
    variable: false,
    auto_confirm: false,
    created_at: "",
    updated_at: "",
    ...over,
  }) as Commitment;

describe("isAwaitingConfirmation", () => {
  const acct = { id: "IUCU", type: "checking" as const };
  const settled = { txn: { id: "t" } as never, viaCover: false };

  it("asks once a manual line's date has arrived", () => {
    expect(
      isAwaitingConfirmation(c({ id: "x", due_hint: "2026-08-01" }), acct, false, null, "2026-08-06"),
    ).toBe(true);
  });

  it("stays quiet before the date", () => {
    expect(
      isAwaitingConfirmation(c({ id: "x", due_hint: "2026-08-23" }), acct, false, null, "2026-08-06"),
    ).toBe(false);
  });

  it("never asks about a synced account — the feed brings it", () => {
    expect(
      isAwaitingConfirmation(c({ id: "x", due_hint: "2026-08-01" }), acct, true, null, "2026-08-06"),
    ).toBe(false);
  });

  it("stops asking once something settles it", () => {
    expect(
      isAwaitingConfirmation(c({ id: "x", due_hint: "2026-08-01" }), acct, false, settled, "2026-08-06"),
    ).toBe(false);
  });

  it("ignores skipped and covered lines", () => {
    expect(isAwaitingConfirmation(c({ id: "x", due_hint: "2026-08-01", skipped: true }), acct, false, null, "2026-08-06")).toBe(false);
    expect(isAwaitingConfirmation(c({ id: "x", due_hint: "2026-08-01", covered_by: "T" }), acct, false, null, "2026-08-06")).toBe(false);
  });

  it("a dateless line never nags", () => {
    expect(
      isAwaitingConfirmation(c({ id: "x", due_hint: null }), acct, false, null, "2026-08-06"),
    ).toBe(false);
  });

  it("honours a grace period", () => {
    const line = c({ id: "x", due_hint: "2026-08-05" });
    expect(isAwaitingConfirmation(line, acct, false, null, "2026-08-06", { graceDays: 3 })).toBe(false);
    expect(isAwaitingConfirmation(line, acct, false, null, "2026-08-09", { graceDays: 3 })).toBe(true);
  });

  it("measures how late a line is", () => {
    expect(daysOverdue("2026-08-01", "2026-08-06")).toBe(5);
    expect(daysOverdue("2026-08-23", "2026-08-06")).toBe(-17);
  });
});

describe("confirmCommitment", () => {
  beforeEach(async () => {
    await db.from("transactions").delete().eq("user_id", "u");
    await db.from("transaction_splits").delete().eq("user_id", "u");
    await db.from("simplefin_account_map").delete().eq("user_id", "u");
  });

  const txns = async () => {
    const { data } = await db.from("transactions").select("*").eq("user_id", "u");
    return (data ?? []) as Record<string, unknown>[];
  };

  it("records the payment and links it to the line", async () => {
    const line = c({ id: "C1", due_hint: "2026-08-01" });
    const { transactionId } = await confirmCommitment(db, line, 300, "2026-08-06");
    const all = await txns();
    const posted = all.find((t) => t.id === transactionId)!;
    expect(posted.commitment_id).toBe("C1");
    expect(Number(posted.amount)).toBe(-300);
    expect(posted.reviewed).toBe(true);
  });

  it("posts the far leg for a transfer, so the loan balance moves", async () => {
    const line = c({ id: "C2", due_hint: "2026-08-01", transfer_account_id: "HELOC" });
    await confirmCommitment(db, line, 300, "2026-08-06");
    const legs = (await txns()).filter((t) => t.account_id === "HELOC");
    expect(legs).toHaveLength(1);
    expect(Number(legs[0].amount)).toBe(300); // reduces what's owed
  });

  it("gives a categorized bill its split", async () => {
    const line = c({
      id: "C3", due_hint: "2026-08-01", kind: "bill",
      category_id: "cat-housing", bucket: "needs", transfer_account_id: null,
    });
    const { transactionId } = await confirmCommitment(db, line, 230.91, "2026-08-06");
    const { data } = await db.from("transaction_splits").select("*").eq("transaction_id", transactionId);
    expect(data).toHaveLength(1);
    expect(Number((data as Record<string, unknown>[])[0].amount)).toBe(-230.91);
  });

  it("takes the actual amount, not the planned one", async () => {
    // the entire reason to ask: a variable bill lands differently
    const line = c({ id: "C4", due_hint: "2026-08-01", amount: -112, transfer_account_id: null });
    const { transactionId } = await confirmCommitment(db, line, 137.44, "2026-08-06");
    const posted = (await txns()).find((t) => t.id === transactionId)!;
    expect(Number(posted.amount)).toBe(-137.44);
  });

  it("income is recorded positive", async () => {
    const line = c({ id: "C5", due_hint: "2026-08-15", kind: "income", amount: 420, transfer_account_id: null });
    const { transactionId } = await confirmCommitment(db, line, 420, "2026-08-15");
    const posted = (await txns()).find((t) => t.id === transactionId)!;
    expect(Number(posted.amount)).toBe(420);
    expect(posted.type).toBe("income");
  });

  it("undo removes what it posted, both legs", async () => {
    const line = c({ id: "C6", due_hint: "2026-08-01", transfer_account_id: "HELOC" });
    await confirmCommitment(db, line, 300, "2026-08-06");
    expect((await txns()).length).toBe(2);
    const { removed } = await unconfirmCommitment(db, "C6");
    expect(removed).toBe(2);
    expect((await txns()).length).toBe(0);
  });

  it("undo leaves a real bank transaction alone", async () => {
    await db.from("transactions").insert({
      id: "FEED", user_id: "u", account_id: "CHK", amount: -300,
      date: "2026-08-06", type: "expense", source: "sync", reviewed: true, commitment_id: "C7",
    });
    const { removed } = await unconfirmCommitment(db, "C7");
    expect(removed).toBe(0);
    expect((await txns()).find((t) => t.id === "FEED")).toBeTruthy();
  });
});
