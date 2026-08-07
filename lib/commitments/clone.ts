import { occurrences } from "@/lib/schedule";
import type { Commitment } from "./types";

/* Clone-forward: materialize a period from the live series.
 *
 * "The rule" is the most recent row in a series, so drafting a month means
 * copying each live series' latest row into the new period, once per scheduled
 * occurrence. Only the current period is ever materialized, which is what keeps
 * the denormalized schedule cheap — there is no fan-out to update when a
 * schedule changes.
 *
 * Anchoring: weekly/biweekly step from the previous occurrence's due_hint, so
 * a fortnightly cadence keeps its phase without needing a stored start_date.
 * Monthly/semimonthly clamp their day to the month's length.
 *
 * Pure. The caller decides which series are live and which periods are missing.
 */

export interface CommitmentDraft {
  series_id: string;
  period: string;
  seq: number;
  name: string;
  kind: Commitment["kind"];
  amount: number;
  account_id?: string | null;
  transfer_account_id?: string | null;
  category_id?: string | null;
  bucket?: Commitment["bucket"];
  due_hint: string | null;
  frequency: Commitment["frequency"];
  day_of_month?: number | null;
  day_of_month_2?: number | null;
  weekday?: number | null;
  interval: number;
  variable: boolean;
  auto_confirm: boolean;
}

const lastDayOfPeriod = (period: string): string => {
  const [y, m] = period.split("-").map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(day).padStart(2, "0")}`;
};

/** Latest row per series — the one that carries the schedule forward. */
export function latestPerSeries(rows: Commitment[]): Commitment[] {
  const best = new Map<string, Commitment>();
  for (const c of rows) {
    const cur = best.get(c.series_id);
    if (!cur || c.period > cur.period || (c.period === cur.period && c.seq > cur.seq)) {
      best.set(c.series_id, c);
    }
  }
  return [...best.values()];
}

/** Occurrence dates for one series within a period. Empty only when the
 *  schedule genuinely produces nothing (e.g. weekly with no anchor). */
export function datesInPeriod(prev: Commitment, period: string): (string | null)[] {
  const from = `${period}-01`;
  const to = lastDayOfPeriod(period);

  const dates = occurrences(
    {
      frequency: prev.frequency,
      day_of_month: prev.day_of_month,
      day_of_month_2: prev.day_of_month_2,
      weekday: prev.weekday,
      interval: prev.interval || 1,
      // biweekly/weekly keep their phase by stepping from the last occurrence
      start_date: prev.due_hint ?? from,
      end_date: null,
    },
    from,
    to,
  );

  // A monthly commitment with no known day still deserves its line — the date
  // is a hint, so "sometime in August" is a legitimate expectation.
  if (dates.length === 0 && (prev.frequency === "monthly" || prev.frequency === "semimonthly")) {
    return [null];
  }
  return dates;
}

/** Draft the next period for every series handed in (caller filters to live
 *  series that don't already have rows in `period`). */
export function cloneForward(latest: Commitment[], period: string): CommitmentDraft[] {
  const out: CommitmentDraft[] = [];
  for (const prev of latest) {
    if (prev.series_ended) continue;
    const dates = datesInPeriod(prev, period);
    dates.forEach((due_hint, i) => {
      out.push({
        series_id: prev.series_id,
        period,
        seq: i,
        name: prev.name,
        kind: prev.kind,
        amount: prev.amount, // edits carry forward
        account_id: prev.account_id ?? null,
        transfer_account_id: prev.transfer_account_id ?? null,
        category_id: prev.category_id ?? null,
        bucket: prev.bucket ?? null,
        due_hint,
        frequency: prev.frequency,
        day_of_month: prev.day_of_month ?? null,
        day_of_month_2: prev.day_of_month_2 ?? null,
        weekday: prev.weekday ?? null,
        interval: prev.interval || 1,
        variable: prev.variable,
        auto_confirm: prev.auto_confirm,
      });
    });
  }
  return out.sort((a, b) =>
    (a.due_hint ?? "9999").localeCompare(b.due_hint ?? "9999") || a.name.localeCompare(b.name),
  );
}
