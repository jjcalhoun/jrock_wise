import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { RecurringRule, RecurringFrequency } from "@/lib/types";
import { clampDay, todayISO, endOfMonthISO } from "@/lib/dates";

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
  const monthEnd = endOfMonthISO();
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

  for (const rule of (rules ?? []) as RecurringRule[]) {
    // On a MANUAL account, pre-post the rest of this month so the items are
    // committed to the budget from the 1st (the balance view ignores dates in
    // the future, so they don't move balances until their day arrives). On a
    // SYNCED account, only post through today — the real charges arrive from the
    // bank feed, and pre-posting would duplicate them.
    const to = synced.has(rule.account_id) ? today : monthEnd;
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
