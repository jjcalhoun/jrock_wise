import type { Transaction } from "./types";
import { INTEREST_RE } from "./classifyTxn";

/* Read-only "interest paid" reporting. Interest is deliberately excluded from
   the budget (no category split), so this surfaces the cost of debt separately.

   A transaction counts as interest if it's tagged source="interest" (manual
   accrual + newer synced interest) or it's an uncategorized expense whose
   description reads like interest (older synced rows from before we tagged the
   source). */
export function isInterestPaid(t: Transaction): boolean {
  if (t.source === "interest") return true;
  const desc = `${t.merchant ?? ""} ${t.description ?? ""}`;
  return t.type === "expense" && (t.splits?.length ?? 0) === 0 && INTEREST_RE.test(desc);
}

/** Total interest paid across the given transactions, optionally on/after a date. */
export function interestPaid(txns: Transaction[], sinceISO?: string): number {
  return txns.reduce((sum, t) => {
    if (!isInterestPaid(t)) return sum;
    if (sinceISO && t.date < sinceISO) return sum;
    return sum + Math.abs(t.amount);
  }, 0);
}

/** Interest paid per account_id, optionally on/after a date. */
export function interestPaidByAccount(
  txns: Transaction[],
  sinceISO?: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of txns) {
    if (!isInterestPaid(t)) continue;
    if (sinceISO && t.date < sinceISO) continue;
    out[t.account_id] = (out[t.account_id] ?? 0) + Math.abs(t.amount);
  }
  return out;
}
