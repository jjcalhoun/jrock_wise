/**
 * Core aggregation logic — ported from BudgetApp.jsx prototype.
 *
 * Rules (locked — from schema.sql and Design Brief):
 *  - Category/bucket spend = expense splits MINUS refund splits (refunds claw back).
 *  - Income = type:'income' only.
 *  - Transfers touch balances only — excluded from spending and income.
 *  - Account balance = starting_balance + transactions dated STRICTLY AFTER as_of_date.
 *  - Splits are SIGNED like the parent amount (expense splits are negative).
 *  - The "spend contribution" of a split is -split.amount
 *    (expense negative → positive spend; refund positive → negative spend = claw-back).
 */

import type { Transaction, Account, BucketType, Rollup } from "./types";

/** "YYYY-MM" key for a date string or Date */
export function monthKey(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date + "T00:00:00") : date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Roll up a list of transactions (with their splits already joined) for a
 * given month key.  If monthKey is omitted, all transactions are included.
 *
 * Returns:
 *   byCat    — net spend per category_id
 *   byBucket — net spend per bucket
 *   income   — total income
 *   spend    — total net spend (sum of byCat values)
 */
export function rollup(
  txns: Transaction[],
  month?: string,
  catBucket?: Record<string, BucketType>, // fallback bucket lookup if split.bucket missing
): Rollup {
  const byCat: Record<string, number> = {};
  const byBucket: Record<BucketType, number> = { needs: 0, wants: 0, savings: 0 };
  let income = 0;
  let spend = 0;

  for (const txn of txns) {
    if (month && monthKey(txn.date) !== month) continue;

    if (txn.type === "income") {
      income += txn.amount;
      continue;
    }
    if (txn.type === "transfer") {
      // A designated transfer (e.g. into savings) counts once toward its bucket
      // and as an allocation in spend; plain transfers are budget-neutral.
      if (txn.bucket) {
        const amt = Math.abs(txn.amount);
        byBucket[txn.bucket] += amt;
        spend += amt;
      }
      continue;
    }

    // expense + refund: aggregate via splits
    for (const split of txn.splits ?? []) {
      // expense split amount is negative → contrib is positive (spend)
      // refund split amount is positive  → contrib is negative (claw-back)
      const contrib = -(split.amount);
      byCat[split.category_id] = (byCat[split.category_id] ?? 0) + contrib;
      const bucket: BucketType =
        split.bucket ?? catBucket?.[split.category_id] ?? "wants";
      byBucket[bucket] += contrib;
      spend += contrib;
    }
  }

  return { byCat, byBucket, income, spend };
}

/**
 * Compute account balance: starting_balance + sum of transactions
 * dated STRICTLY AFTER the account's as_of_date.
 */
export function accountBalance(account: Account, txns: Transaction[]): number {
  const acctTxns = txns.filter(
    (t) => t.account_id === account.id && t.date > account.as_of_date,
  );
  return account.starting_balance + acctTxns.reduce((s, t) => s + t.amount, 0);
}
