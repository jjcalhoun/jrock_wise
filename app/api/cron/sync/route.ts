import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncUser } from "@/lib/simplefinSync";
import { accrueInterest } from "@/lib/interest";
import { postEscrow } from "@/lib/escrow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* GET /api/cron/sync — daily SimpleFIN sync, plus the carrying charges a
   liability account accrues on its own (interest, escrow). Nothing here posts
   a payment on a schedule any more; expected payments live in the plan and are
   settled by the feed or by hand.
   Invoked by Vercel Cron. Protected by CRON_SECRET: Vercel automatically sends
   `Authorization: Bearer <CRON_SECRET>` when that env var is set. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Distinct users with a SimpleFIN connection or a liability account that
  // carries charges of its own (interest, or escrow on a mortgage).
  const [{ data: conns, error: cErr }, { data: liab, error: lErr }] = await Promise.all([
    supabase.from("simplefin_connections").select("user_id"),
    supabase
      .from("accounts")
      .select("user_id")
      .in("type", ["credit", "loan"])
      .or("apr.gt.0,escrow_amount.gt.0"),
  ]);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 });

  const userIds = [
    ...new Set([
      ...(conns ?? []).map((c) => c.user_id as string),
      ...(liab ?? []).map((a) => a.user_id as string),
    ]),
  ];

  let inserted = 0;
  let balancesUpdated = 0;
  let interestInserted = 0;
  let escrowInserted = 0;
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
      const acc = await accrueInterest(supabase, userId);
      interestInserted += acc.inserted;
      errors.push(...acc.errors);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `interest failed for ${userId}`);
    }
    try {
      const esc = await postEscrow(supabase, userId);
      escrowInserted += esc.inserted;
      errors.push(...esc.errors);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : `escrow failed for ${userId}`);
    }
  }

  return NextResponse.json({
    users: userIds.length,
    inserted,
    balancesUpdated,
    interestInserted,
    escrowInserted,
    errors,
  });
}
