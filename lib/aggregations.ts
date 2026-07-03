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

import type { Transaction, Account, AccountType, BucketType, Rollup } from "./types";

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
  savingsAccountIds: Set<string> = new Set(), // accounts whose transfers move the savings bucket
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
      // The savings bucket tracks net flow through savings accounts: money moving
      // INTO a savings account (that account's inflow, amount > 0) adds to the
      // bucket; money moving OUT (amount < 0) subtracts. We count only the
      // savings-account leg, so each transfer is counted once with its natural
      // sign. Transfers between non-savings accounts are budget-neutral.
      if (savingsAccountIds.has(txn.account_id)) {
        byBucket.savings += txn.amount;
        spend += txn.amount;
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

export interface CashOutSegment {
  key: string;
  label: string;
  color: string;
  icon: string;
  value: number;
}

// Fixed slices for cash that leaves an asset account as a transfer, by where
// it goes. Category-based (real purchases) segments are built from the txns.
const DEST_SEGMENTS: Record<"credit" | "loan" | "savings" | "transfer", Omit<CashOutSegment, "value">> = {
  credit: { key: "dest:credit", label: "Credit card payments", color: "#EF4444", icon: "credit_card" },
  loan: { key: "dest:loan", label: "Loan / HELOC payments", color: "#F97316", icon: "account_balance" },
  savings: { key: "dest:savings", label: "Savings", color: "#22C55E", icon: "savings" },
  transfer: { key: "dest:transfer", label: "Transfers", color: "#8B5CF6", icon: "swap_horiz" },
};

/**
 * "Where did my cash actually go this month" — a cash-flow lens, distinct from
 * the budget lens (rollup). Counts money LEAVING your asset accounts
 * (checking/savings/cash):
 *   - purchases paid from an asset account → grouped by category
 *   - a transfer OUT of an asset account → grouped by destination type
 *     (credit-card payment, loan/HELOC payment, savings, or plain transfer)
 * and deliberately EXCLUDES credit-card purchases (they sit on the liability and
 * move no cash until the card is paid), so nothing double-counts.
 */
export function cashOut(
  txns: Transaction[],
  accountType: Record<string, AccountType>,
  categoryById: Record<string, { name: string; color: string; icon: string }>,
  month?: string,
): { segments: CashOutSegment[]; total: number } {
  const acc = new Map<string, CashOutSegment>();
  const add = (seg: Omit<CashOutSegment, "value">, value: number) => {
    const cur = acc.get(seg.key);
    if (cur) cur.value += value;
    else acc.set(seg.key, { ...seg, value });
  };
  const isAsset = (t?: AccountType) => t === "checking" || t === "savings" || t === "cash";

  for (const txn of txns) {
    if (month && monthKey(txn.date) !== month) continue;
    const at = accountType[txn.account_id];

    if (txn.type === "expense" || txn.type === "refund") {
      // Only cash purchases (from an asset account) moved money; a charge on a
      // credit/loan account did not.
      if (!isAsset(at)) continue;
      for (const split of txn.splits ?? []) {
        const cat = categoryById[split.category_id];
        if (!cat) continue;
        add(
          { key: `cat:${split.category_id}`, label: cat.name, color: cat.color, icon: cat.icon },
          -split.amount, // expense split neg → positive cash out; refund claws back
        );
      }
    } else if (txn.type === "transfer") {
      // Count only the asset-account outflow leg (cash actually leaving).
      if (!isAsset(at) || txn.amount >= 0) continue;
      const destType = txn.transfer_account_id ? accountType[txn.transfer_account_id] : undefined;
      const bucket =
        destType === "credit" ? "credit" : destType === "loan" ? "loan" : destType === "savings" ? "savings" : "transfer";
      add(DEST_SEGMENTS[bucket], -txn.amount);
    }
    // income is not cash out
  }

  const segments = [...acc.values()].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const total = segments.reduce((s, c) => s + c.value, 0);
  return { segments, total };
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
