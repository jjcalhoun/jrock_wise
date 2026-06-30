import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

interface Mapping {
  simplefin_account_id: string;
  account_id: string;
  org_name?: string;
}

/* POST /api/simplefin/map  { connectionId, mappings: Mapping[] }
   Links SimpleFIN accounts to our accounts. Upserts on the unique
   (user_id, simplefin_account_id) so re-mapping replaces the prior link. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let connectionId: string;
  let mappings: Mapping[];
  try {
    ({ connectionId, mappings } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!connectionId || !Array.isArray(mappings) || mappings.length === 0) {
    return NextResponse.json({ error: "Missing connection or mappings" }, { status: 400 });
  }

  const rows = mappings.map((m) => ({
    user_id: user.id,
    connection_id: connectionId,
    simplefin_account_id: m.simplefin_account_id,
    account_id: m.account_id,
    org_name: m.org_name ?? null,
  }));

  const { error } = await supabase
    .from("simplefin_account_map")
    .upsert(rows, { onConflict: "user_id,simplefin_account_id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ mapped: rows.length });
}
