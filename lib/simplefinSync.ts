import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/crypto";
import { fetchAccounts } from "@/lib/simplefin";
import { guessCategory } from "@/lib/autocategorize";
import type { Category } from "@/lib/types";

const DAYS_90 = 90 * 24 * 60 * 60;

export interface SyncResult {
  inserted: number;
  balancesUpdated: number;
  errors: string[];
}

/* Core SimpleFIN sync for one user. Works with any Supabase client whose queries
   resolve to this user's rows — the session client (RLS scopes automatically) or
   the service-role admin client used by the cron (we scope by userId here).
   Pulls 90 days, updates live balances on mapped accounts, and inserts new
   transactions (unreviewed) with an optional best-guess category. */
export async function syncUser(
  supabase: SupabaseClient,
  userId: string,
  opts: { connectionId?: string } = {},
): Promise<SyncResult> {
  const [{ data: settings }, { data: categories }, { data: maps }] = await Promise.all([
    supabase.from("settings").select("autocategorize_imports").eq("user_id", userId).single(),
    supabase.from("categories").select("*").eq("user_id", userId).eq("is_archived", false),
    supabase.from("simplefin_account_map").select("*").eq("user_id", userId),
  ]);
  const autocategorize = settings?.autocategorize_imports ?? true;
  const cats = (categories ?? []) as Category[];
  const accountFor = new Map(
    (maps ?? []).map((m) => [m.simplefin_account_id as string, m.account_id as string]),
  );

  let connQuery = supabase
    .from("simplefin_connections")
    .select("id, access_url_enc")
    .eq("user_id", userId);
  if (opts.connectionId) connQuery = connQuery.eq("id", opts.connectionId);
  const { data: connections, error: connErr } = await connQuery;
  if (connErr) throw new Error(connErr.message);

  const startDate = Math.floor(Date.now() / 1000) - DAYS_90;
  let inserted = 0;
  let balancesUpdated = 0;
  const errors: string[] = [];

  for (const conn of connections ?? []) {
    let accessUrl: string;
    try {
      accessUrl = decrypt(conn.access_url_enc as string);
    } catch {
      errors.push("Could not decrypt a connection");
      continue;
    }

    let set;
    try {
      set = await fetchAccounts(accessUrl, { startDate, pending: true });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "Fetch failed");
      continue;
    }
    errors.push(...set.errors);

    for (const acct of set.accounts) {
      const ourAccountId = accountFor.get(acct.id);
      if (!ourAccountId) continue; // unmapped — skip until the user maps it

      // 1. Live balance (decision 1: trust SimpleFIN's balance for linked accts).
      const { error: balErr } = await supabase
        .from("accounts")
        .update({
          live_balance: Number(acct.balance),
          live_balance_at: new Date(acct["balance-date"] * 1000).toISOString(),
        })
        .eq("id", ourAccountId)
        .eq("user_id", userId);
      if (!balErr) balancesUpdated++;

      // 2. New transactions (dedupe on external_id = simplefin:<id>).
      const incoming = acct.transactions ?? [];
      if (incoming.length === 0) continue;

      const externalIds = incoming.map((t) => `simplefin:${t.id}`);
      const { data: existing } = await supabase
        .from("transactions")
        .select("external_id")
        .eq("account_id", ourAccountId)
        .in("external_id", externalIds);
      const seen = new Set((existing ?? []).map((r) => r.external_id as string));

      for (const t of incoming) {
        const externalId = `simplefin:${t.id}`;
        if (seen.has(externalId)) continue;
        seen.add(externalId);

        const amount = Number(t.amount);
        const description = t.payee || t.description || "Transaction";
        const isExpense = amount < 0;
        const guess = autocategorize && isExpense ? guessCategory(description, cats) : null;

        const { data: txn, error: txnErr } = await supabase
          .from("transactions")
          .insert({
            user_id: userId,
            account_id: ourAccountId,
            date: new Date(t.posted * 1000).toISOString().slice(0, 10),
            amount,
            description,
            merchant: description,
            type: isExpense ? "expense" : "income",
            source: "sync",
            external_id: externalId,
            reviewed: false,
          })
          .select("id")
          .single();
        if (txnErr || !txn) {
          errors.push(txnErr?.message ?? "Insert failed");
          continue;
        }
        inserted++;

        // Best-guess split for categorized expenses (signed, sums to parent).
        if (guess) {
          await supabase.from("transaction_splits").insert({
            user_id: userId,
            transaction_id: txn.id,
            category_id: guess.id,
            bucket: guess.bucket,
            amount,
          });
        }
      }
    }

    await supabase
      .from("simplefin_connections")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("id", conn.id)
      .eq("user_id", userId);
  }

  return { inserted, balancesUpdated, errors };
}
