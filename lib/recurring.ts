import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { RecurringRule, RecurringFrequency } from "@/lib/types";
import { clampDay, todayISO } from "@/lib/dates";

/* Recurring transaction generation. Pure date math (occurrences) is unit-tested;
   generateRecurring materializes the rows. Occurrences are produced only through
   `to` (today) so future-dated rows never inflate computed balances. */

export interface Schedule {
  frequency: RecurringFrequency;
  day_of_month?: number | null;
  day_of_month_2?: number | null;
  weekday?: number | null;
  interval?: number | null;
  start_date: string;
  end_date?: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);

/** All occurrence dates (ISO) for a rule within [from, to], inclusive. */
export function occurrences(rule: Schedule, from: string, to: string): string[] {
  const lo = from < rule.start_date ? rule.start_date : from;
  const hi = rule.end_date && rule.end_date < to ? rule.end_date : to;
  if (lo > hi) return [];

  const out: string[] = [];
  const loD = parse(lo);
  const hiD = parse(hi);

  if (rule.frequency === "monthly" || rule.frequency === "semimonthly") {
    const days = [rule.day_of_month, rule.frequency === "semimonthly" ? rule.day_of_month_2 : null]
      .filter((d): d is number => typeof d === "number");
    // walk each month from lo's month through hi's month
    let y = loD.getUTCFullYear();
    let m = loD.getUTCMonth();
    const endY = hiD.getUTCFullYear();
    const endM = hiD.getUTCMonth();
    while (y < endY || (y === endY && m <= endM)) {
      for (const day of days) {
        const d = iso(new Date(Date.UTC(y, m, clampDay(y, m, day))));
        if (d >= lo && d <= hi) out.push(d);
      }
      m++;
      if (m > 11) { m = 0; y++; }
    }
  } else {
    // weekly / biweekly: step days from the anchor — the rule's weekday on or
    // after start_date (falling back to start_date's own weekday).
    const step = (rule.frequency === "biweekly" ? 14 : 7) * (rule.interval || 1);
    let anchor = parse(rule.start_date);
    if (typeof rule.weekday === "number") {
      const shift = (rule.weekday - anchor.getUTCDay() + 7) % 7;
      anchor = new Date(anchor.getTime() + shift * 86400000);
    }
    for (let t = anchor.getTime(); t <= hiD.getTime(); t += step * 86400000) {
      const d = iso(new Date(t));
      if (d >= lo) out.push(d);
    }
  }

  return [...new Set(out)].sort();
}

const addDay = (s: string) => iso(new Date(parse(s).getTime() + 86400000));

export interface GenerateResult {
  inserted: number;
  errors: string[];
}

/** Materialize due occurrences for every active rule of a user, up to today. */
export async function generateRecurring(
  supabase: SupabaseClient,
  userId: string,
): Promise<GenerateResult> {
  const today = todayISO();
  const [{ data: rules, error }, { data: maps }] = await Promise.all([
    supabase.from("recurring_rules").select("*").eq("user_id", userId).eq("active", true),
    supabase.from("simplefin_account_map").select("account_id").eq("user_id", userId),
  ]);
  if (error) throw new Error(error.message);
  // Bank-synced accounts get the real counterpart through the feed, so we only
  // post a manual counterpart row for transfers into a manual account.
  const synced = new Set((maps ?? []).map((m) => m.account_id as string));

  let inserted = 0;
  const errors: string[] = [];

  // Commitments drafted from these rules — generated rows link to them so the
  // ledger marks the commitment paid instead of double-counting. A rule's id is
  // its series_id (the phase-1 backfill reused it), and lookup is by PERIOD
  // rather than exact date: the due date is a hint, so a generated row on the
  // 6th still fulfills a commitment hinted at the 5th.
  const { data: commitments } = await supabase
    .from("commitments")
    .select("id, series_id, period, due_hint, seq")
    .eq("user_id", userId);
  const byPeriod = new Map<string, { id: string; due_hint: string | null; seq: number }[]>();
  for (const c of commitments ?? []) {
    const key = `${c.series_id}|${c.period}`;
    const arr = byPeriod.get(key);
    const row = { id: c.id as string, due_hint: (c.due_hint as string) ?? null, seq: c.seq as number };
    if (arr) arr.push(row);
    else byPeriod.set(key, [row]);
  }
  /** The occurrence in this rule's series closest to `date` within its period. */
  const commitmentFor = (ruleId: string, date: string): string | null => {
    const rows = byPeriod.get(`${ruleId}|${date.slice(0, 7)}`);
    if (!rows || rows.length === 0) return null;
    const scored = [...rows].sort((a, b) => {
      const da = a.due_hint ? Math.abs(Date.parse(a.due_hint) - Date.parse(date)) : Infinity;
      const db = b.due_hint ? Math.abs(Date.parse(b.due_hint) - Date.parse(date)) : Infinity;
      return da - db || a.seq - b.seq;
    });
    return scored[0].id;
  };

  for (const rule of (rules ?? []) as RecurringRule[]) {
    // SYNCED accounts get NO generated rows at all: the real transactions
    // arrive from the bank feed, and the month plan already carries the
    // expectation (the feed row links to its plan item in review). Generating
    // here would duplicate every paycheck/charge. Just advance the watermark.
    if (synced.has(rule.account_id)) {
      await supabase
        .from("recurring_rules")
        .update({ last_generated: today })
        .eq("id", rule.id)
        .eq("user_id", userId);
      continue;
    }
    // On a MANUAL account, post occurrences only up to TODAY — never ahead.
    //
    // This used to pre-post the rest of the month so items were committed to
    // the budget from the 1st. Commitments do that job now: the ledger counts a
    // planned occurrence from the 1st whether or not a transaction exists. The
    // pre-posted rows became pure duplication, and worse, an unlinked future row
    // counted as money already received — two future paydays showed up as $840
    // of "extra income" on top of the same $840 the plan already expected.
    const to = today;
    const from = rule.last_generated ? addDay(rule.last_generated) : rule.start_date;
    const dates = occurrences(rule, from, to);
    let failed = false;

    if (dates.length > 0) {
      const externalIds = dates.map((d) => `recurring:${rule.id}:${d}`);
      const { data: existing } = await supabase
        .from("transactions")
        .select("external_id")
        .eq("account_id", rule.account_id)
        .in("external_id", externalIds);
      const seen = new Set((existing ?? []).map((r) => r.external_id as string));

      for (const date of dates) {
        const externalId = `recurring:${rule.id}:${date}`;
        if (seen.has(externalId)) continue;

        // Two-sided transfers (e.g. a credit-card/HELOC payment) get a linked
        // counterpart row on the other account, so both balances move: the
        // source drops and the destination's owed balance is paid down. Only
        // when the counterpart account is manual (synced ones get it from the
        // bank feed).
        const counterAcct = rule.transfer_account_id ?? null;
        const twoSided =
          rule.type === "transfer" && !!counterAcct && !synced.has(counterAcct);
        const group = twoSided ? randomUUID() : null;

        const { data: txn, error: txnErr } = await supabase
          .from("transactions")
          .insert({
            user_id: userId,
            account_id: rule.account_id,
            date,
            amount: rule.amount,
            description: rule.name,
            merchant: rule.name,
            type: rule.type,
            transfer_account_id: rule.type === "transfer" ? counterAcct : null,
            transfer_group_id: group,
            source: "recurring",
            external_id: externalId,
            reviewed: rule.auto_review,
            commitment_id: commitmentFor(rule.id, date),
          })
          .select("id")
          .single();
        if (txnErr || !txn) {
          errors.push(txnErr?.message ?? "Insert failed");
          failed = true;
          continue;
        }
        inserted++;

        // expense/income with a category get a split (signed, sums to parent).
        if (rule.type !== "transfer" && rule.category_id && rule.bucket) {
          await supabase.from("transaction_splits").insert({
            user_id: userId,
            transaction_id: txn.id,
            category_id: rule.category_id,
            bucket: rule.bucket,
            amount: rule.amount,
          });
        }

        if (twoSided) {
          const { error: cErr } = await supabase.from("transactions").insert({
            user_id: userId,
            account_id: counterAcct,
            date,
            amount: -rule.amount,
            description: rule.name,
            merchant: rule.name,
            type: "transfer",
            transfer_account_id: rule.account_id,
            transfer_group_id: group,
            source: "recurring",
            external_id: `${externalId}:c`,
            reviewed: rule.auto_review,
            // Same commitment as the primary leg — the ledger counts a linked
            // pair once (it prefers the outflow leg).
            commitment_id: commitmentFor(rule.id, date),
          });
          if (cErr) {
            // Roll back the primary so the pair is retried atomically next run.
            await supabase.from("transactions").delete().eq("id", txn.id);
            inserted--;
            errors.push(cErr.message);
            failed = true;
            continue;
          }
          inserted++;
        }
      }
    }

    // Advance the watermark to the horizon we generated through (this month's
    // end on manual accounts, today on synced) — only when nothing failed, so a
    // transient insert error is retried next run (external_id dedupe prevents
    // duplicates).
    if (!failed) {
      await supabase
        .from("recurring_rules")
        .update({ last_generated: to })
        .eq("id", rule.id)
        .eq("user_id", userId);
    }
  }

  return { inserted, errors };
}
