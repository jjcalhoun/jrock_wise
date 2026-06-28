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

import type { Transaction, TransactionSplit, Account, BucketType, Rollup } from "./types";

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
    if (txn.type === "transfer") continue; // balances only

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

/**
 * Compute balances for all accounts in a map keyed by account_id.
 */
export function allBalances(
  accounts: Account[],
  txns: Transaction[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const acct of accounts) {
    out[acct.id] = accountBalance(acct, txns);
  }
  return out;
}

/**
 * Average monthly spend for a category over the last N months ending at
 * (but not including) the current month.
 *
 * @param txns  All transactions with splits joined.
 * @param catId Category ID to average.
 * @param asOf  The reference date (usually today). Averages go backwards from here.
 * @param months  3 or 6.
 */
export function categoryAverage(
  txns: Transaction[],
  catId: string,
  asOf: Date,
  months: number,
): number {
  const sums: number[] = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(asOf.getFullYear(), asOf.getMonth() - i, 1);
    const mk = monthKey(d);
    const { byCat } = rollup(txns, mk);
    sums.push(byCat[catId] ?? 0);
  }
  return sums.reduce((a, b) => a + b, 0) / months;
}

/**
 * 3-month and 6-month averages for a given category.
 */
export function categoryAverages(
  txns: Transaction[],
  catId: string,
  asOf: Date = new Date(),
): { avg3: number; avg6: number } {
  return {
    avg3: categoryAverage(txns, catId, asOf, 3),
    avg6: categoryAverage(txns, catId, asOf, 6),
  };
}

/**
 * Validate that splits on an expense or refund transaction sum to the
 * parent amount (within a cent of floating-point tolerance).
 */
export function splitsBalanced(
  amount: number,
  splits: Pick<TransactionSplit, "amount">[],
): boolean {
  if (splits.length === 0) return false;
  const total = splits.reduce((s, sp) => s + sp.amount, 0);
  return Math.abs(total - amount) < 0.005;
}
