import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accrueInterest } from "@/lib/interest";
import { postEscrow } from "@/lib/escrow";

export const runtime = "nodejs";

/* POST /api/charges/post — post the carrying charges on manual liability
   accounts for the signed-in user (called on app open). RLS scopes everything
   to the session.

   This used to also run the recurring generator, which wrote a transaction for
   every schedule that had come due. Nothing does that any more: a synced
   account gets the real payment from the bank feed, and a manual one waits to
   be confirmed. What's left are the charges no payment produces — interest and
   escrow — which the account accrues whether you touch the app or not. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const interest = await accrueInterest(supabase, user.id);
    const escrow = await postEscrow(supabase, user.id);
    return NextResponse.json({
      inserted: interest.inserted + escrow.inserted,
      errors: [...interest.errors, ...escrow.errors],
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Posting charges failed" },
      { status: 500 },
    );
  }
}
