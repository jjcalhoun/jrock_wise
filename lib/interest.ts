import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "@/lib/types";
import { daysInMonth, todayISO } from "@/lib/dates";

/* Estimated monthly interest for MANUAL liability accounts (loans/cards not
   linked to SimpleFIN — synced ones get the bank's real interest charge).
   Posts once per month on the statement day (default: last day of month),
   computed from the current outstanding balance and APR, so payments already
   applied lower it. Pure helpers are unit-tested. */

const iso = (d: Date) => d.toISOString().slice(0, 10);

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

/** Every statement that has occurred in (since, today] — oldest first.
 *
 *  accrueInterest used to post only the MOST RECENT statement, so if the app
 *  went unopened across two statement dates the older month was never
 *  backfilled and the debt silently under-accrued. Statements on or before
 *  `since` are excluded on purpose: the balance entered as of that date
 *  already reflects them, and posting again would double-count. */
export function statementsSince(
  today: string,
  statementDay: number | null | undefined,
  since: string,
): { monthKey: string; postDate: string }[] {
  const out: { monthKey: string; postDate: string }[] = [];
  const start = new Date(`${since}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);

  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  const endY = end.getUTCFullYear();
  const endM = end.getUTCMonth();

  while (y < endY || (y === endY && m <= endM)) {
    const day = Math.min(statementDay ?? daysInMonth(y, m), daysInMonth(y, m));
    const postDate = iso(new Date(Date.UTC(y, m, day)));
    if (postDate > since && postDate <= today) {
      out.push({ monthKey: `${y}-${String(m + 1).padStart(2, "0")}`, postDate });
    }
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return out;
}

export interface AccrueResult {
  inserted: number;
  errors: string[];
}

export async function accrueInterest(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccrueResult> {
  const today = todayISO();

  const [{ data: accounts }, { data: maps }] = await Promise.all([
    supabase.from("accounts").select("*").eq("user_id", userId),
    supabase.from("simplefin_account_map").select("account_id").eq("user_id", userId),
  ]);

  const linked = new Set((maps ?? []).map((m) => m.account_id as string));

  let inserted = 0;
  const errors: string[] = [];

  for (const a of (accounts ?? []) as Account[]) {
    const isLiability = a.type === "credit" || a.type === "loan";
    if (!isLiability || a.apr <= 0 || linked.has(a.id)) continue; // synced/manual asset → skip

    const due = statementsSince(today, a.statement_day, a.as_of_date);
    if (due.length === 0) continue;

    // Movements since the account's baseline, so each statement is computed
    // from what was owed AT THAT TIME rather than from today's balance.
    const { data: txns } = await supabase
      .from("transactions")
      .select("date, amount, external_id")
      .eq("account_id", a.id)
      .gt("date", a.as_of_date);
    const movements = (txns ?? []).map((t) => ({
      date: t.date as string,
      amount: Number(t.amount),
    }));
    const posted = new Set((txns ?? []).map((t) => t.external_id as string | null));

    for (const { monthKey, postDate } of due) {
      const externalId = `interest:${a.id}:${monthKey}`;
      if (posted.has(externalId)) continue;

      const movedBy = movements
        .filter((m) => m.date <= postDate)
        .reduce((s, m) => s + m.amount, 0);
      const owed = Math.max(0, -(a.starting_balance + movedBy));
      const interest = monthlyInterest(owed, a.apr);
      if (interest <= 0) continue;

      // No category split: the amount increases what's owed (so it shows in the
      // account balance), but with no split it is excluded from spend/leftover —
      // spend is computed only from splits.
      const { error: txnErr } = await supabase.from("transactions").insert({
        user_id: userId,
        account_id: a.id,
        date: postDate,
        amount: -interest, // increases what's owed
        description: "Interest charge",
        merchant: "Interest charge",
        type: "expense",
        source: "interest",
        external_id: externalId,
        reviewed: true,
      });
      if (txnErr) {
        errors.push(txnErr.message);
        continue;
      }
      inserted++;
      // later statements compound on this one
      movements.push({ date: postDate, amount: -interest });
    }
  }

  return { inserted, errors };
}
