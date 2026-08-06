import type { BucketType, RecurringFrequency } from "@/lib/types";

/** What a commitment represents. Mirrors the old PlanItemKind. */
export type CommitmentKind = "income" | "bill" | "debt" | "savings" | "cc_payment";

/** One expected payment in one period.
 *
 *  Identity is (series_id, period, seq) — never the date. `due_hint` orders the
 *  list and drives overdue nudges; it does not decide what a row IS. The
 *  schedule fields describe how to make the NEXT occurrence, so "the rule" is
 *  simply the most recent row in a series. */
export interface Commitment {
  id: string;
  user_id: string;
  series_id: string;
  period: string; // "YYYY-MM"
  seq: number;

  name: string;
  kind: CommitmentKind;
  amount: number; // signed: income positive, outgoing negative. PLANNED.
  account_id?: string | null;
  transfer_account_id?: string | null;
  category_id?: string | null;
  bucket?: BucketType | null;

  due_hint?: string | null;

  frequency: RecurringFrequency;
  day_of_month?: number | null;
  day_of_month_2?: number | null;
  weekday?: number | null;
  interval: number;
  series_ended: boolean;

  skipped: boolean;
  /** settled by a payment that primarily fulfills another occurrence */
  covered_by?: string | null;
  variable: boolean;
  auto_confirm: boolean;

  created_at: string;
  updated_at: string;
}

/** The schedule half of a commitment — what cloning forward needs. */
export type CommitmentSchedule = Pick<
  Commitment,
  "frequency" | "day_of_month" | "day_of_month_2" | "weekday" | "interval" | "due_hint"
>;

/** Kinds that describe money moving to another account you own. Such a
 *  commitment already knows its destination, so matching a payment to one is
 *  enough to say the payment is a transfer. */
const TRANSFER_KINDS = new Set<CommitmentKind>(["debt", "cc_payment", "savings"]);

export function commitmentTransferTarget(
  c: Pick<Commitment, "kind" | "transfer_account_id"> | null | undefined,
): string | null {
  if (!c || !c.transfer_account_id) return null;
  return TRANSFER_KINDS.has(c.kind) ? c.transfer_account_id : null;
}
