import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecurringRule, RecurringFrequency } from "@/lib/types";

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
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const clampDay = (y: number, m0: number, day: number) => Math.min(day, daysInMonth(y, m0));

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
    // weekly / biweekly: step days from the start anchor
    const step = (rule.frequency === "biweekly" ? 14 : 7) * (rule.interval || 1);
    const start = parse(rule.start_date);
    for (let t = start.getTime(); t <= hiD.getTime(); t += step * 86400000) {
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
  const today = iso(new Date());
  const { data: rules, error } = await supabase
    .from("recurring_rules")
    .select("*")
    .eq("user_id", userId)
    .eq("active", true);
  if (error) throw new Error(error.message);

  let inserted = 0;
  const errors: string[] = [];

  for (const rule of (rules ?? []) as RecurringRule[]) {
    const from = rule.last_generated ? addDay(rule.last_generated) : rule.start_date;
    const dates = occurrences(rule, from, today);

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
            transfer_account_id: rule.type === "transfer" ? rule.transfer_account_id ?? null : null,
            source: "recurring",
            external_id: externalId,
            reviewed: rule.auto_review,
          })
          .select("id")
          .single();
        if (txnErr || !txn) {
          errors.push(txnErr?.message ?? "Insert failed");
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
      }
    }

    await supabase
      .from("recurring_rules")
      .update({ last_generated: today })
      .eq("id", rule.id)
      .eq("user_id", userId);
  }

  return { inserted, errors };
}
