import type { AccountType, TransactionType } from "@/lib/types";

/* Classify a synced transaction into a budget type, instead of the naive
   "negative = expense, positive = income" which breaks on liability accounts
   (a credit-card charge arrives with the opposite sign from a checking debit,
   so interest was landing as income).

   Decisions:
   - Card/loan interest & finance charges → expense (Fees & Interest), auto-reviewed.
   - Card/loan payments (and the matching checking debit) → transfer, excluded
     from spend/income, auto-reviewed.
   - Real purchases → expense, sent to Review to categorize.
   - The liability sign convention is inferred per-account from the reported
     balance sign, so it adapts to whatever the institution does. */

const PAYMENT_RE = /\b(payment|autopay|auto[\s-]?pay|thank\s*you|online\s*payment|e-?pay|bill\s*pay)\b/i;
const INTEREST_RE = /(interest|finance\s*charge|fin\s*chg|apr\s*charge)/i;

export interface ClassifyInput {
  amount: number; // signed, as reported by SimpleFIN
  description: string;
  accountType: AccountType;
  accountBalance: number; // SimpleFIN's reported balance for the account
}

export interface Classification {
  type: TransactionType;
  /** Amount normalized to the app's convention (expense neg, income/refund pos). */
  normalizedAmount: number;
  /** Interest/fee → categorize to "Fees" rather than a guessed category. */
  interest: boolean;
  /** Skip the Review queue (interest + payments only). */
  autoReview: boolean;
}

export function classifyTxn({
  amount,
  description,
  accountType,
  accountBalance,
}: ClassifyInput): Classification {
  const mag = Math.abs(amount);
  const liability = accountType === "credit" || accountType === "loan";

  // Payments move money between accounts — never spend or income.
  if (PAYMENT_RE.test(description)) {
    return { type: "transfer", normalizedAmount: amount, interest: false, autoReview: true };
  }

  if (liability) {
    if (INTEREST_RE.test(description)) {
      return { type: "expense", normalizedAmount: -mag, interest: true, autoReview: true };
    }
    // A "charge" increases what you owe. Whether that's a + or - amount depends
    // on how the institution signs the balance, so infer from the balance.
    const owedPositive = accountBalance >= 0; // balance reported as amount-owed
    const isCharge = owedPositive ? amount > 0 : amount < 0;
    return isCharge
      ? { type: "expense", normalizedAmount: -mag, interest: false, autoReview: false }
      : { type: "refund", normalizedAmount: mag, interest: false, autoReview: false };
  }

  // Asset accounts (checking/savings/cash): plain sign.
  return amount < 0
    ? { type: "expense", normalizedAmount: -mag, interest: false, autoReview: false }
    : { type: "income", normalizedAmount: mag, interest: false, autoReview: false };
}
