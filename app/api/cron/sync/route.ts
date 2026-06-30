import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncUser } from "@/lib/simplefinSync";
import { generateRecurring } from "@/lib/recurring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* GET /api/cron/sync — daily SimpleFIN sync for every user with a connection.
   Invoked by Vercel Cron. Protected by CRON_SECRET: Vercel automatically sends
   `Authorization: Bearer <CRON_SECRET>` when that env var is set. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Distinct users with a SimpleFIN connection and/or recurring rules.
  const [{ data: conns, error: cErr }, { data: rules, error: rErr }] = await Promise.all([
    supabase.from("simplefin_connections").select("user_id"),
    supabase.from("recurring_rules").select("user_id").eq("active", true),
  ]);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const userIds = [
    ...new Set([
      ...(conns ?? []).map((c) => c.user_id as string),
      ...(rules ?? []).map((r) => r.user_id as string),
    ]),
  ];

  let inserted = 0;
  let balancesUpdated = 0;
  let recurringInserted = 0;
  const errors: string[] = [];
  for (const userId of userIds) {
    try {
      const r = await syncUser(supabase, userId);
      inserted += r.inserted;
      balancesUpdated += r.balancesUpdated;
      errors.push(...r.errors);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `sync failed for ${userId}`);
    }
    try {
      const g = await generateRecurring(supabase, userId);
      recurringInserted += g.inserted;
      errors.push(...g.errors);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `recurring failed for ${userId}`);
    }
  }

  return NextResponse.json({
    users: userIds.length,
    inserted,
    balancesUpdated,
    recurringInserted,
    errors,
  });
}
