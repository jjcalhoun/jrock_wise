import type { BucketType, RecurringFrequency } from "@/lib/types";
import { occurrences } from "@/lib/schedule";
import type { Commitment, CommitmentKind } from "./types";
import type { CommitmentDraft } from "./clone";

/* A series, defined by nothing but its own occurrences.
 *
 * `recurring_rules` used to hold the definition and `commitments` the
 * instances, which meant two records of one fact and a sync step between them —
 * the source of the duplicate bills, the "make this recurring" twins, and rows
 * that drifted apart whenever an edit touched one side and not the other.
 *
 * There is one record now. A commitment carries its own schedule, so the most
 * recent row in a series IS the rule; editing the series means rewriting this
 * period's rows and letting clone-forward carry the change onward. Nothing has
 * to be kept in step because there is no second copy.
 *
 * Everything here is pure. The caller decides which rows are settled and must
 * therefore be preserved.
 */

export interface SeriesInput {
  name: string;
  kind: CommitmentKind;
  /** magnitude; sign is decided by kind */
  amount: number;
  account_id: string;
  transfer_account_id?: string | null;
  category_id?: string | null;
  bucket?: BucketType | null;
  frequency: RecurringFrequency;
  day_of_month?: number | null;
  day_of_month_2?: number | null;
  weekday?: number | null;
  interval?: number | null;
  variable?: boolean;
  /** ended series produce no further occurrences */
  ended?: boolean;
}

const lastDayOfPeriod = (period: string): string => {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** Signed planned amount: income positive, everything else negative. */
export const signedAmount = (kind: CommitmentKind, magnitude: number): number =>
  kind === "income" ? Math.abs(magnitude) : -Math.abs(magnitude);

/** The dates a series lands on within one period.
 *
 *  The WHOLE period, including days already past — a series created on the
 *  20th for a bill due on the 3rd still needs its line, or the payment that
 *  already went out has nothing to match against. */
export function occurrencesInPeriod(input: SeriesInput, period: string): (string | null)[] {
  const dates = occurrences(
    {
      frequency: input.frequency,
      day_of_month: input.day_of_month,
      day_of_month_2: input.day_of_month_2,
      weekday: input.weekday,
      interval: input.interval ?? 1,
      start_date: `${period}-01`,
      end_date: null,
    },
    `${period}-01`,
    lastDayOfPeriod(period),
  );
  // A monthly line with no computable day is still a real expectation —
  // "sometime this month" — and the date was only ever a hint.
  if (dates.length === 0 && (input.frequency === "monthly" || input.frequency === "semimonthly")) {
    return [null];
  }
  return dates;
}

/** The rows a series should have in a period. */
export function seriesDrafts(
  input: SeriesInput,
  seriesId: string,
  period: string,
): CommitmentDraft[] {
  const amount = signedAmount(input.kind, input.amount);
  return occurrencesInPeriod(input, period).map((due_hint, seq) => ({
    series_id: seriesId,
    period,
    seq,
    name: input.name,
    kind: input.kind,
    amount,
    account_id: input.account_id,
    transfer_account_id: input.transfer_account_id ?? null,
    category_id: input.category_id ?? null,
    bucket: input.bucket ?? null,
    due_hint,
    frequency: input.frequency,
    day_of_month: input.day_of_month ?? null,
    day_of_month_2: input.day_of_month_2 ?? null,
    weekday: input.weekday ?? null,
    interval: input.interval ?? 1,
    variable: input.variable ?? false,
    auto_confirm: false,
  }));
}

/** What an edit does to a period that already has rows.
 *
 *  Settled rows are never rewritten or removed: a payment happened, and the
 *  line it fulfilled has to keep saying what it was. The rest is replaced, and
 *  the replacements are seq-numbered after the survivors so the unique
 *  constraint on (series, period, seq) still holds.
 *
 *  Reducing a weekly bill to monthly mid-month with two weeks already paid
 *  therefore leaves those two paid weeks alone and adds the monthly line —
 *  which is the honest reading of what happened. */
export interface SeriesEditPlan {
  /** ids to delete: unsettled rows the edit supersedes */
  remove: string[];
  /** rows to insert */
  insert: CommitmentDraft[];
  /** ids whose schedule fields should be refreshed in place (settled rows) */
  restamp: string[];
}

export function planSeriesEdit(
  input: SeriesInput,
  seriesId: string,
  period: string,
  existing: Commitment[],
  isSettled: (c: Commitment) => boolean,
): SeriesEditPlan {
  const inPeriod = existing.filter((c) => c.series_id === seriesId && c.period === period);
  const settled = inPeriod.filter(isSettled);
  const remove = inPeriod.filter((c) => !isSettled(c)).map((c) => c.id);

  // One draft per occurrence, minus the ones already paid for.
  const wanted = seriesDrafts(input, seriesId, period);
  const keep = settled.length;
  const insert = wanted.slice(keep).map((d, i) => ({ ...d, seq: keep + i }));

  return { remove, insert, restamp: settled.map((c) => c.id) };
}

/** The schedule fields an edit pushes onto rows it doesn't rebuild. */
export function scheduleFields(input: SeriesInput) {
  return {
    frequency: input.frequency,
    day_of_month: input.day_of_month ?? null,
    day_of_month_2: input.day_of_month_2 ?? null,
    weekday: input.weekday ?? null,
    interval: input.interval ?? 1,
    series_ended: input.ended ?? false,
  };
}

/** The live series in a set of rows, newest occurrence first — what the plan
 *  offers for editing and what duplicate detection compares. */
export function seriesFrom(rows: Commitment[]): Commitment[] {
  const best = new Map<string, Commitment>();
  for (const c of rows) {
    const cur = best.get(c.series_id);
    if (!cur || c.period > cur.period || (c.period === cur.period && c.seq > cur.seq)) {
      best.set(c.series_id, c);
    }
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The transaction `type` a commitment of this kind posts as. */
export const kindToType = (
  kind: CommitmentKind,
  transferTo?: string | null,
): "income" | "expense" | "transfer" =>
  kind === "income" ? "income" : transferTo ? "transfer" : "expense";

/** The kind a reviewed transaction becomes when you tick "repeat this".
 *
 *  A transfer's destination decides it: money into a loan is a debt payment,
 *  into a card a card payment, into savings a deposit. Getting this from the
 *  destination rather than asking is what keeps a mortgage in the debt math
 *  even while you think of it as housing. */
export function reviewKind(
  type: string,
  transferAccountId: string | null | undefined,
  accounts: { id: string; type: string }[],
): CommitmentKind {
  if (type === "income") return "income";
  if (type !== "transfer" || !transferAccountId) return "bill";
  switch (accounts.find((a) => a.id === transferAccountId)?.type) {
    case "loan":
      return "debt";
    case "credit":
      return "cc_payment";
    case "savings":
      return "savings";
    default:
      return "bill";
  }
}

/** Round-trip a series back into the input shape, for edits that change only
 *  one thing (ending it, say) and must leave the rest exactly as it was. */
export function seriesInputFrom(c: Commitment, ended?: boolean): SeriesInput {
  return {
    name: c.name,
    kind: c.kind,
    amount: Math.abs(c.amount),
    account_id: c.account_id ?? "",
    transfer_account_id: c.transfer_account_id ?? null,
    category_id: c.category_id ?? null,
    bucket: c.bucket ?? null,
    frequency: c.frequency,
    day_of_month: c.day_of_month ?? null,
    day_of_month_2: c.day_of_month_2 ?? null,
    weekday: c.weekday ?? null,
    interval: c.interval || 1,
    variable: c.variable,
    ended: ended ?? c.series_ended,
  };
}
