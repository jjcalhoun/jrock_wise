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
});
