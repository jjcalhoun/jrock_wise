import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/crypto";
import { fetchAccounts } from "@/lib/simplefin";

export const runtime = "nodejs";

/* POST /api/simplefin/accounts  { connectionId }
   Lists the SimpleFIN accounts for an existing connection (balances only), so
   the user can map a bank they've already connected. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let connectionId: string;
  try {
    ({ connectionId } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }

  const { data: conn, error } = await supabase
    .from("simplefin_connections")
    .select("access_url_enc")
    .eq("id", connectionId)
    .eq("user_id", user.id)
    .single();
  if (error || !conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  try {
    const set = await fetchAccounts(decrypt(conn.access_url_enc as string), {
      balancesOnly: true,
    });
    const accounts = set.accounts.map((a) => ({
      simplefin_account_id: a.id,
      org_name: a.org?.name ?? a.org?.domain ?? "Bank",
      name: a.name,
      balance: a.balance,
      currency: a.currency,
    }));
    return NextResponse.json({ connectionId, accounts });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fetch failed" },
      { status: 502 },
    );
  }
}
