import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDemoClient } from "@/lib/demo/client";
import { generateRecurring } from "./recurring";

/* Exercised against the in-memory client, so the real query shapes run.

   The rule under test: generation NEVER runs ahead of today. Pre-posting the
   rest of the month used to be the point — items had to be committed to the
   budget from the 1st — but commitments do that now, and a future-dated row
   that nobody has linked reads as money already received. */

const db = createDemoClient() as unknown as SupabaseClient;
const today = new Date().toISOString().slice(0, 10);
const daysFromNow = (n: number) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const RULE = "40000000-0000-0000-0000-000000000009";

describe("generateRecurring", () => {
  beforeEach(async () => {
    await db.from("transactions").delete().eq("user_id", "u");
    await db.from("recurring_rules").delete().eq("user_id", "u");
    await db.from("commitments").delete().eq("user_id", "u");
    await db.from("simplefin_account_map").delete().eq("user_id", "u");
  });

  const addDailyRule = async (over: Record<string, unknown> = {}) =>
    db.from("recurring_rules").insert({
      id: RULE,
      user_id: "u",
      name: "Payday allocation",
      account_id: "MANUAL",
      type: "income",
      amount: 420,
      frequency: "weekly",
      weekday: new Date().getUTCDay(),
      interval: 1,
      start_date: daysFromNow(-30),
      active: true,
      auto_review: true,
      last_generated: null,
      ...over,
    });

  const rows = async () => {
    const { data } = await db.from("transactions").select("*").eq("user_id", "u");
    return (data ?? []) as { date: string; external_id: string | null }[];
  };

  it("never posts a row dated after today", async () => {
    await addDailyRule();
    await generateRecurring(db, "u");
    const posted = await rows();
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every((r) => r.date <= today)).toBe(true);
  });

  it("leaves the watermark at today, not at month end", async () => {
    await addDailyRule();
    await generateRecurring(db, "u");
    const { data: rule } = await db
      .from("recurring_rules")
      .select("last_generated")
      .eq("id", RULE)
      .maybeSingle();
    expect((rule as { last_generated: string }).last_generated).toBe(today);
  });

  it("is idempotent — a second run posts nothing new", async () => {
    await addDailyRule();
    await generateRecurring(db, "u");
    const first = (await rows()).length;
    await generateRecurring(db, "u");
    expect((await rows()).length).toBe(first);
  });

  it("posts nothing at all for a synced account", async () => {
    await addDailyRule({ account_id: "SYNCED" });
    await db.from("simplefin_account_map").insert({ user_id: "u", account_id: "SYNCED" });
    await generateRecurring(db, "u");
    expect(await rows()).toHaveLength(0);
  });

  it("links what it posts to the matching commitment", async () => {
    await addDailyRule();
    await db.from("commitments").insert({
      id: "C1",
      user_id: "u",
      series_id: RULE,
      period: today.slice(0, 7),
      seq: 0,
      name: "Payday allocation",
      kind: "income",
      amount: 420,
      due_hint: today,
    });
    await generateRecurring(db, "u");
    const { data } = await db
      .from("transactions")
      .select("*")
      .eq("user_id", "u")
      .eq("date", today);
    const posted = (data ?? []) as { commitment_id: string | null }[];
    expect(posted.length).toBeGreaterThan(0);
    // unlinked generated income is exactly what showed up as phantom "extra income"
    expect(posted.every((r) => r.commitment_id === "C1")).toBe(true);
  });
});
