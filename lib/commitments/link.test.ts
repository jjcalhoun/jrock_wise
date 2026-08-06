import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "@/lib/demo/client";
import { linkTransactionToCommitment } from "./link";

/* Exercised against the in-memory demo client, which implements the same
   query surface — so this covers the real call shapes, not a hand-rolled mock. */

const db = createDemoClient() as unknown as SupabaseClient;

const rowsOf = async (ids: string[]) => {
  const { data } = await db.from("transactions").select("*").in("id", ids);
  return Object.fromEntries(
    (data as { id: string }[]).map((r) => [r.id, r as Record<string, unknown>]),
  );
};

describe("linkTransactionToCommitment", () => {
  beforeEach(async () => {
    await db.from("transactions").delete().eq("user_id", "test");
    await db.from("transactions").insert([
      { id: "A", user_id: "test", reviewed: true, commitment_id: null, transfer_group_id: null },
      { id: "B", user_id: "test", reviewed: true, commitment_id: "C1", transfer_group_id: null },
    ]);
  });

  it("links a free commitment without touching anything else", async () => {
    const { released } = await linkTransactionToCommitment(db, "A", "C2");
    expect(released).toEqual([]);
    const rows = await rowsOf(["A", "B"]);
    expect(rows.A.commitment_id).toBe("C2");
    expect(rows.B.commitment_id).toBe("C1"); // untouched
    expect(rows.B.reviewed).toBe(true);
  });

  it("stealing a claimed commitment sends the previous holder back to review", async () => {
    const { released } = await linkTransactionToCommitment(db, "A", "C1");
    expect(released).toEqual(["B"]);
    const rows = await rowsOf(["A", "B"]);
    expect(rows.A.commitment_id).toBe("C1");
    expect(rows.B.commitment_id).toBeNull();
    expect(rows.B.reviewed).toBe(false); // resurfaces so the mistake is visible
  });

  it("unlinking clears the link and releases nobody", async () => {
    const { released } = await linkTransactionToCommitment(db, "B", null);
    expect(released).toEqual([]);
    const rows = await rowsOf(["B"]);
    expect(rows.B.commitment_id).toBeNull();
    expect(rows.B.reviewed).toBe(true); // unlinking yourself is not a mistake
  });

  it("re-linking a transaction to what it already holds is a no-op", async () => {
    const { released } = await linkTransactionToCommitment(db, "B", "C1");
    expect(released).toEqual([]);
    const rows = await rowsOf(["B"]);
    expect(rows.B.commitment_id).toBe("C1");
    expect(rows.B.reviewed).toBe(true);
  });

  it("legs of the same transfer never evict each other", async () => {
    await db.from("transactions").insert([
      { id: "OUT", user_id: "test", reviewed: true, commitment_id: "C3", transfer_group_id: "g1" },
      { id: "IN", user_id: "test", reviewed: true, commitment_id: null, transfer_group_id: "g1" },
    ]);
    const { released } = await linkTransactionToCommitment(db, "IN", "C3");
    expect(released).toEqual([]);
    const rows = await rowsOf(["OUT", "IN"]);
    expect(rows.OUT.commitment_id).toBe("C3"); // pair intact
    expect(rows.IN.commitment_id).toBe("C3");
  });

  it("a different transfer's leg IS evicted", async () => {
    await db.from("transactions").insert([
      { id: "OTHER", user_id: "test", reviewed: true, commitment_id: "C4", transfer_group_id: "g9" },
      { id: "MINE", user_id: "test", reviewed: true, commitment_id: null, transfer_group_id: "g2" },
    ]);
    const { released } = await linkTransactionToCommitment(db, "MINE", "C4");
    expect(released).toEqual(["OTHER"]);
    const rows = await rowsOf(["OTHER"]);
    expect(rows.OTHER.reviewed).toBe(false);
  });

  describe("a debt/card commitment makes the payment a transfer", () => {
    beforeEach(async () => {
      await db.from("commitments").delete().eq("user_id", "test");
      await db.from("accounts").delete().eq("user_id", "test");
      await db.from("commitments").insert([
        { id: "C-DEBT", user_id: "test", kind: "debt", transfer_account_id: "LOAN", period: "2026-08" },
        { id: "C-BILL", user_id: "test", kind: "bill", transfer_account_id: null, period: "2026-08" },
      ]);
    });

    it("converts the payment and posts the leg the loan needs", async () => {
      // a mortgage payment arriving from the synced bank as a plain expense
      await db.from("transactions").insert({
        id: "PAY", user_id: "test", account_id: "CHK", amount: -583.57,
        date: "2026-08-01", type: "expense", reviewed: false, merchant: "CITIZENS",
      });
      const { becameTransfer } = await linkTransactionToCommitment(db, "PAY", "C-DEBT");
      expect(becameTransfer).toBe(true);

      const { data: pay } = await db.from("transactions").select("*").eq("id", "PAY").maybeSingle();
      expect(pay.type).toBe("transfer");
      expect(pay.transfer_account_id).toBe("LOAN");

      // the far leg exists, so the loan balance actually moves
      const { data } = await db.from("transactions").select("*").eq("account_id", "LOAN");
      const legs = (data ?? []) as Record<string, unknown>[];
      expect(legs).toHaveLength(1);
      expect(Number(legs[0].amount)).toBeCloseTo(583.57, 2);
      expect(legs[0].transfer_group_id).toBe(pay.transfer_group_id);
    });

    it("leaves an ordinary bill alone", async () => {
      await db.from("transactions").insert({
        id: "UTIL", user_id: "test", account_id: "CHK", amount: -61.96,
        date: "2026-08-18", type: "expense", reviewed: false,
      });
      const { becameTransfer } = await linkTransactionToCommitment(db, "UTIL", "C-BILL");
      expect(becameTransfer).toBe(false);
      const { data: u } = await db.from("transactions").select("*").eq("id", "UTIL").maybeSingle();
      expect(u.type).toBe("expense");
    });

    it("pairs with an existing counterpart instead of posting a second one", async () => {
      await db.from("transactions").insert([
        { id: "OUT2", user_id: "test", account_id: "CHK", amount: -300, date: "2026-08-08", type: "expense", reviewed: false },
        { id: "IN2", user_id: "test", account_id: "LOAN", amount: 300, date: "2026-08-08", type: "expense", reviewed: false },
      ]);
      await linkTransactionToCommitment(db, "OUT2", "C-DEBT");
      const { data } = await db.from("transactions").select("*").eq("account_id", "LOAN");
      const legs = (data ?? []) as Record<string, unknown>[];
      expect(legs).toHaveLength(1); // paired, not duplicated
      expect(legs[0].id).toBe("IN2");
      expect(legs[0].type).toBe("transfer");
    });

    it("is idempotent — re-linking doesn't post another leg", async () => {
      await db.from("transactions").insert({
        id: "PAY3", user_id: "test", account_id: "CHK", amount: -240,
        date: "2026-08-23", type: "expense", reviewed: false,
      });
      await linkTransactionToCommitment(db, "PAY3", "C-DEBT");
      await linkTransactionToCommitment(db, "PAY3", "C-DEBT");
      const { data } = await db.from("transactions").select("*").eq("account_id", "LOAN");
      const legs = (data ?? []) as Record<string, unknown>[];
      expect(legs).toHaveLength(1);
    });
  });
});
