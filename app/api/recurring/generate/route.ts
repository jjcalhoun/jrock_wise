import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateRecurring } from "@/lib/recurring";
import { accrueInterest } from "@/lib/interest";

export const runtime = "nodejs";

/* POST /api/recurring/generate — materialize due recurring transactions for the
   signed-in user (called on app open). RLS scopes everything to the session. */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await generateRecurring(supabase, user.id);
    const interest = await accrueInterest(supabase, user.id);
    return NextResponse.json({
      inserted: result.inserted + interest.inserted,
      errors: [...result.errors, ...interest.errors],
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Generate failed" },
      { status: 500 },
    );
  }
}
