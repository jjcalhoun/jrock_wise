import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/crypto";
import { claimSetupToken, fetchAccounts } from "@/lib/simplefin";

export const runtime = "nodejs";

/* POST /api/simplefin/claim  { setupToken }
   Claims a one-time SimpleFIN setup token, stores the (encrypted) access URL,
   and returns the connected accounts so the user can map them to ours. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let setupToken: string;
  try {
    ({ setupToken } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!setupToken?.trim()) {
    return NextResponse.json({ error: "Missing setup token" }, { status: 400 });
  }

  let accessUrl: string;
  try {
    accessUrl = await claimSetupToken(setupToken);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Claim failed" },
      { status: 400 },
    );
  }

  const { data: connection, error: insErr } = await supabase
    .from("simplefin_connections")
    .insert({ user_id: user.id, access_url_enc: encrypt(accessUrl) })
    .select("id")
    .single();
  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Balances-only fetch to list accounts for the mapping step.
  let accounts;
  try {
    const set = await fetchAccounts(accessUrl, { balancesOnly: true });
    accounts = set.accounts.map((a) => ({
      simplefin_account_id: a.id,
      org_name: a.org?.name ?? a.org?.domain ?? "Bank",
      name: a.name,
      balance: a.balance,
      currency: a.currency,
    }));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fetch failed", connectionId: connection.id },
      { status: 502 },
    );
  }

  return NextResponse.json({ connectionId: connection.id, accounts });
}
