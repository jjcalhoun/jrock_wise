import type { RecurringFrequency } from "@/lib/types";
import { clampDay } from "@/lib/dates";

/* Schedule date math. Pure and unit-tested.

   This module used to also materialize rows on a timer — that generator is
   gone. Nothing writes a transaction because a date passed: a bank-synced
   account gets the real one from the feed, and a manual one waits for you to
   confirm it happened. What remains here is the arithmetic both paths need:
   given a schedule, which dates does it land on?

   The one consumer that matters is clone-forward, which asks this for the
   occurrences of a series within one period. */

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

