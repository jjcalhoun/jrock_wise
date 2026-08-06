import type { Account } from "@/lib/types";
import type { Commitment } from "./types";
import type { Settlement } from "./restore";

/* Which commitments are waiting for you to say they happened.
 *
 * On a bank-synced account nothing waits: the feed brings the real transaction
 * and review matches it. On a MANUAL account there is no feed, so the only way
 * a payment gets recorded is if the app writes it — and the app doesn't know
 * whether it actually went through.
 *
 * Generation used to just assert it did, posting the row on schedule. That is
 * the assumption this replaces: an expected payment stays expected until you
 * confirm it, and confirming is what creates the transaction.
 */

export interface DueOptions {
  /** grace period before a commitment starts asking, in days (default 0) */
  graceDays?: number;
}

/** True when this line is on a manual account, its date has arrived, and
 *  nothing has settled it yet. */
export function isAwaitingConfirmation(
  c: Pick<Commitment, "due_hint" | "skipped" | "covered_by" | "account_id">,
  account: Pick<Account, "id" | "type"> | undefined,
  isSynced: boolean,
  settlement: Settlement | null,
  today: string,
  opts: DueOptions = {},
): boolean {
  if (settlement) return false; // already accounted for
  if (c.skipped || c.covered_by) return false;
  if (!c.account_id || !account) return false;
  if (isSynced) return false; // the feed will bring it

  // No date means no way to know it's due yet — it waits for the month to end
  // rather than nagging from the 1st.
  if (!c.due_hint) return false;

  const grace = opts.graceDays ?? 0;
  const dueBy = grace === 0 ? c.due_hint : shift(c.due_hint, grace);
  return dueBy <= today;
}

const shift = (iso: string, days: number) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000)
    .toISOString()
    .slice(0, 10);

/** How overdue a line is, for ordering the nags. Negative means not yet due. */
export function daysOverdue(due_hint: string | null | undefined, today: string): number {
  if (!due_hint) return 0;
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due_hint}T00:00:00Z`)) / 86400000,
  );
}
