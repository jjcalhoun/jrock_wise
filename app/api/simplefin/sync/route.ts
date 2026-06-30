import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncUser } from "@/lib/simplefinSync";

export const runtime = "nodejs";

/* POST /api/simplefin/sync  { connectionId? }
   Pulls balances + transactions for the signed-in user's SimpleFIN
   connections. RLS scopes everything to the session user. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let connectionId: string | undefined;
  try {
    ({ connectionId } = await request.json().catch(() => ({})));
  } catch {
    /* empty body is fine */
  }

  try {
    const result = await syncUser(supabase, user.id, { connectionId });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sync failed" },
      { status: 500 },
    );
  }
}
