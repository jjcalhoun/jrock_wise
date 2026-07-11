export type AccountType = "checking" | "savings" | "credit" | "loan" | "cash";
export type TransactionType = "expense" | "income" | "transfer" | "refund";
export type BucketType = "needs" | "wants" | "savings";
export type ThemeMode = "system" | "light" | "dark";
export type DebtStrategy = "avalanche" | "snowball";
export type TransactionSource = "manual" | "csv" | "sync" | "recurring" | "interest";

export interface Account {
  id: string;
  user_id: string;
  name: string;
  type: AccountType;
  last4?: string | null;
  starting_balance: number;
  as_of_date: string; // ISO date
  apr: number;
  color?: string | null;
  sort_order: number;
  min_payment?: number | null; // liability accounts: minimum monthly payment
  statement_day?: number | null; // liability accounts: day interest posts
  live_balance?: number | null; // SimpleFIN live balance for linked accounts
  live_balance_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  icon: string; // Material Symbols name
  color: string;
  bucket: BucketType;
  is_archived: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface TransactionSplit {
  id: string;
  user_id: string;
  transaction_id: string;
  category_id: string;
  bucket: BucketType;
  amount: number; // signed; sums to parent transaction.amount
  created_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  date: string; // ISO date
  amount: number; // signed: negative = outflow, positive = inflow
  merchant?: string | null;
  description?: string | null;
  type: TransactionType;
  transfer_account_id?: string | null;
  transfer_group_id?: string | null;
  bucket?: BucketType | null; // transfers only: count toward this budget bucket
  notes?: string | null;
  source: TransactionSource;
  external_id?: string | null;
  import_batch_id?: string | null;
  reviewed: boolean;
  plan_item_id?: string | null; // fulfills this month-plan item (explicit link)
  created_at: string;
  updated_at: string;
  // joined
  splits?: TransactionSplit[];
}

export interface RecurringBill {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  category_id?: string | null;
  account_id?: string | null;
  day_of_month?: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BudgetPlan {
  user_id: string;
  income: number;
  plan_needs: number;
  plan_wants: number;
  plan_savings: number;
  updated_at: string;
}

export interface CategoryBudget {
  user_id: string;
  category_id: string;
  monthly_target: number;
}

export interface Settings {
  user_id: string;
  import_start_date?: string | null;
  theme_mode: ThemeMode;
  debt_strategy: DebtStrategy;
  debt_extra: number;
  debt_surplus?: number | null; // editable surplus; null → 3-month average
  autocategorize_imports: boolean;
  investments_balance: number;
  investments_return: number;
  invest_monthly: number;
  invest_employer_match: number;
  invest_current_age?: number | null;
  invest_retire_age?: number | null;
  surplus_savings_pct: number;
  surplus_investments_pct: number;
  updated_at: string;
}

export type RecurringFrequency = "monthly" | "semimonthly" | "weekly" | "biweekly";

export interface RecurringRule {
  id: string;
  user_id: string;
  name: string;
  account_id: string;
  type: "expense" | "income" | "transfer";
  amount: number; // signed
  transfer_account_id?: string | null;
  category_id?: string | null;
  bucket?: BucketType | null;
  frequency: RecurringFrequency;
  day_of_month?: number | null;
  day_of_month_2?: number | null;
  weekday?: number | null;
  interval: number;
  start_date: string;
  end_date?: string | null;
  auto_review: boolean;
  last_generated?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/* ---- Month plan (the "Free to spend" ledger) ---- */
export type PlanItemKind = "income" | "bill" | "debt" | "savings" | "cc_payment";

export interface MonthPlan {
  id: string;
  user_id: string;
  month: string; // "YYYY-MM"
  confirmed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MonthPlanItem {
  id: string;
  user_id: string;
  plan_id: string;
  rule_id?: string | null; // rule it was drafted from (snapshot — rule edits don't rewrite it)
  name: string;
  kind: PlanItemKind;
  amount: number; // signed: income positive, outgoing negative
  due_date?: string | null;
  variable: boolean; // variable bills always confirm in review
  excluded: boolean; // kept but not counted this month
  created_at: string;
}

export interface SimplefinConnection {
  id: string;
  user_id: string;
  last_synced_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SimplefinAccountMapping {
  id: string;
  user_id: string;
  connection_id: string;
  simplefin_account_id: string;
  account_id: string;
  org_name?: string | null;
  created_at: string;
}

export interface AccountBalance {
  account_id: string;
  user_id: string;
  balance: number;
}

/* ---- Aggregation result types ---- */
export interface Rollup {
  byCat: Record<string, number>;      // category_id -> net spend (expense minus refunds)
  byBucket: Record<BucketType, number>; // bucket -> net spend
  income: number;
  spend: number;
}
