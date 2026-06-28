import type { BucketType, AccountType } from "./types";

export const BUCKETS: Record<BucketType, { label: string; color: string }> = {
  needs: { label: "Needs", color: "#3B82F6" },
  wants: { label: "Wants", color: "#EAB308" },
  savings: { label: "Savings", color: "#22C55E" },
};

export const ACCOUNT_TYPES: { value: AccountType; label: string; icon: string }[] = [
  { value: "checking", label: "Checking", icon: "account_balance" },
  { value: "savings", label: "Savings", icon: "savings" },
  { value: "credit", label: "Credit", icon: "credit_card" },
  { value: "loan", label: "Loan", icon: "account_balance_wallet" },
  { value: "cash", label: "Cash", icon: "payments" },
];

/** Accounts that normally carry a negative (owed) balance. */
export const LIABILITY_TYPES: AccountType[] = ["credit", "loan"];
