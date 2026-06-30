import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@/lib/types";

/* Estimated monthly interest for MANUAL liability accounts (loans/cards not
   linked to SimpleFIN — synced ones get the bank's real interest charge).
   Posts once per month on the statement day (default: last day of month),
   computed from the current outstanding balance and APR, so payments already
   applied lower it. Pure helpers are unit-tested. */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Monthly interest on an outstanding balance at an annual percentage rate. */
export function monthlyInterest(owed: number, apr: number): number {
  if (owed <= 0 || apr <= 0) return 0;
  return Math.round(((owed * apr) / 1200) * 100) / 100;
}

/** The most recent statement that has occurred on/before `today`.
    statementDay null → last day of the month. */
export function lastStatement(
  today: string,
  statementDay: number | null | undefined,
): { monthKey: string; postDate: string } {
  const t = new Date(`${today}T00:00:00Z`);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const dayFor = (yy: number, mm: number) =>
    Math.min(statementDay ?? daysInMonth(yy, mm), daysInMonth(yy, mm));
  const thisStmt = iso(new Date(Date.UTC(y, m, dayFor(y, m))));
  if (today >= thisStmt) {
    return { monthKey: `${y}-${String(m + 1).padStart(2, "0")}`, postDate: thisStmt };
  }
  const py = m === 0 ? y - 1 : y;
  const pm = m === 0 ? 11 : m - 1;
  return {
    monthKey: `${py}-${String(pm + 1).padStart(2, "0")}`,
    postDate: iso(new Date(Date.UTC(py, pm, dayFor(py, pm)))),
  };
}

export interface AccrueResult {
  inserted: number;
  errors: string[];
}

export async function accrueInterest(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccrueResult> {
  const today = iso(new Date());

  const [{ data: accounts }, { data: maps }, { data: cats }, { data: balances }] =
    await Promise.all([
      supabase.from("accounts").select("*").eq("user_id", userId),
      supabase.from("simplefin_account_map").select("account_id").eq("user_id", userId),
      supabase.from("categories").select("id, bucket, name").eq("user_id", userId),
      supabase.from("account_balances").select("account_id, balance").eq("user_id", userId),
    ]);

  const linked = new Set((maps ?? []).map((m) => m.account_id as string));
  const balanceOf = new Map((balances ?? []).map((b) => [b.account_id as string, Number(b.balance)]));
  const fees = (cats ?? []).find((c) => c.name === "Fees") as { id: string; bucket: string } | undefined;

  let inserted = 0;
  const errors: string[] = [];

  for (const a of (accounts ?? []) as Account[]) {
    const isLiability = a.type === "credit" || a.type === "loan";
    if (!isLiability || a.apr <= 0 || linked.has(a.id)) continue; // synced/manual asset → skip

    const { monthKey, postDate } = lastStatement(today, a.statement_day);
    if (postDate < a.as_of_date) continue; // don't backfill before the account started

    const owed = Math.max(0, -(balanceOf.get(a.id) ?? a.starting_balance));
    const interest = monthlyInterest(owed, a.apr);
    if (interest <= 0) continue;

    const externalId = `interest:${a.id}:${monthKey}`;
    const { data: existing } = await supabase
      .from("transactions")
      .select("id")
      .eq("account_id", a.id)
      .eq("external_id", externalId)
      .maybeSingle();
    if (existing) continue;

    const amount = -interest; // increases what's owed
    const { data: txn, error: txnErr } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        account_id: a.id,
        date: postDate,
        amount,
        description: "Interest charge",
        merchant: "Interest charge",
        type: "expense",
        source: "interest",
        external_id: externalId,
        reviewed: true,
      })
      .select("id")
      .single();
    if (txnErr || !txn) {
      errors.push(txnErr?.message ?? "Interest insert failed");
      continue;
    }
    inserted++;

    if (fees) {
      await supabase.from("transaction_splits").insert({
        user_id: userId,
        transaction_id: txn.id,
        category_id: fees.id,
        bucket: fees.bucket,
        amount,
      });
    }
  }

  return { inserted, errors };
}
