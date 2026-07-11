import type {
  Transaction,
  RecurringRule,
  Account,
  MonthPlanItem,
  PlanItemKind,
} from "./types";
import { occurrences } from "./recurring";
import { monthKey } from "./aggregations";

/* The month-plan ledger — the math behind "Free to spend".
 *
 *   expected income (confirmed plan items)
 * − commitments (bills, debt payments, CC payments, savings — planned until
 *   their linked transaction posts, then the actual amount)
 * = baseline on the 1st
 * − discretionary spend (unlinked, cash-view)
 * + extra income (actual income beyond the plan)
 * = free to spend
 *
 * Cash view: credit-card PURCHASES don't reduce free-to-spend (the monthly
 * CC payment commitment does). Transfers between cash accounts are neutral.
 * The ledger runs ONLY on explicit links (transactions.plan_item_id) —
 * fuzzy matching elsewhere merely suggests links for the user to confirm.
 */

/* ---------- drafting: rules → proposed plan items ---------- */

export interface PlanDraftItem {
  rule_id: string;
  name: string;
  kind: PlanItemKind;
  amount: number; // signed: income positive, outgoing negative
  due_date: string;
  variable: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Kind of commitment a rule represents; null → not a plan item (e.g. a
 *  checking-to-checking transfer, which is cash-neutral). */
export function ruleKind(
  rule: Pick<RecurringRule, "type" | "transfer_account_id">,
  accountById: Record<string, Pick<Account, "type">>,
): PlanItemKind | null {
  if (rule.type === "income") return "income";
  if (rule.type === "expense") return "bill";
  // transfer: classify by destination account
  const dest = rule.transfer_account_id ? accountById[rule.transfer_account_id] : null;
  if (!dest) return null;
  if (dest.type === "loan") return "debt";
  if (dest.type === "credit") return "cc_payment";
  if (dest.type === "savings") return "savings";
  return null; // checking/cash ← cash-neutral shuffle
}

/** A rule is "variable" when its recent matching transactions vary >5% —
 *  variable commitments always pass through review instead of auto-filling. */
export function isVariableRule(rule: RecurringRule, txns: Transaction[]): boolean {
  const r = norm(rule.name);
  const mags = txns
    .filter((t) => {
      if (t.account_id !== rule.account_id) return false;
      const m = norm(t.merchant || t.description || "");
      return !!m && !!r && (m === r || m.includes(r) || r.includes(m));
    })
    .map((t) => Math.abs(t.amount))
    .slice(-6);
  if (mags.length < 2) return false;
  const min = Math.min(...mags);
  const max = Math.max(...mags);
  return min > 0 && (max - min) / min > 0.05;
}

/** Draft plan items for a month from the active rules: one item per scheduled
 *  occurrence (a semimonthly bill yields two lines, each fillable on its own). */
export function buildPlanDraft(
  rules: RecurringRule[],
  month: string,
  accounts: Pick<Account, "id" | "type">[],
  history: Transaction[] = [],
): PlanDraftItem[] {
  const accountById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const out: PlanDraftItem[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    const kind = ruleKind(rule, accountById);
    if (!kind) continue;
    const dates = occurrences(rule, `${month}-01`, lastDayOfMonth(month));
    if (dates.length === 0) continue;
    const mag = Math.abs(rule.amount);
    const amount = kind === "income" ? mag : -mag;
    const variable = kind === "income" ? false : isVariableRule(rule, history);
    for (const due_date of dates) {
      out.push({ rule_id: rule.id, name: rule.name, kind, amount, due_date, variable });
    }
  }
  return out.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
}

/* ---------- the ledger ---------- */

export interface LedgerItem extends MonthPlanItem {
  status: "expected" | "paid";
  /** signed actual from linked transactions (null until paid) */
  actual: number | null;
  /** the amount the ledger counts: actual when paid, planned otherwise */
  effective: number;
}

export interface Ledger {
  expectedIncome: number; // planned income (positive)
  commitmentsPlanned: number; // planned outgoing (positive magnitude)
  baseline: number; // expectedIncome − commitmentsPlanned
  incomeEffective: number; // planned-or-actual income
  commitmentsEffective: number; // planned-or-actual outgoing (positive)
  extraIncome: number; // unlinked actual income
  discretionary: number; // unlinked cash-view spend (positive)
  freeToSpend: number;
  items: LedgerItem[];
}

export interface LedgerContext {
  creditAccountIds: Set<string>;
  loanAccountIds: Set<string>;
  savingsAccountIds: Set<string>;
}

/** Signed actual for an item from its linked transactions. Two-sided transfers
 *  may have either (or both) legs linked; prefer the outflow legs so a linked
 *  pair isn't double-counted. */
function linkedActual(item: MonthPlanItem, linked: Transaction[]): number | null {
  if (linked.length === 0) return null;
  if (item.kind === "income") return linked.reduce((s, t) => s + t.amount, 0);
  const outLegs = linked.filter((t) => t.amount < 0);
  const legs = outLegs.length > 0 ? outLegs : linked;
  return -legs.reduce((s, t) => s + Math.abs(t.amount), 0);
}

export function ledger(
  items: MonthPlanItem[],
  transactions: Transaction[],
  month: string,
  ctx: LedgerContext,
): Ledger {
  const monthTxns = transactions.filter((t) => monthKey(t.date) === month);

  const linkedByItem = new Map<string, Transaction[]>();
  for (const t of monthTxns) {
    if (!t.plan_item_id) continue;
    const arr = linkedByItem.get(t.plan_item_id);
    if (arr) arr.push(t);
    else linkedByItem.set(t.plan_item_id, [t]);
  }

  let expectedIncome = 0;
  let commitmentsPlanned = 0;
  let incomeEffective = 0;
  let commitmentsEffective = 0;

  const ledgerItems: LedgerItem[] = items.map((item) => {
    const linked = item.excluded ? [] : (linkedByItem.get(item.id) ?? []);
    const actual = linkedActual(item, linked);
    const status: LedgerItem["status"] = actual !== null ? "paid" : "expected";
    const effective = item.excluded ? 0 : (actual ?? item.amount);
    if (!item.excluded) {
      if (item.kind === "income") {
        expectedIncome += item.amount;
        incomeEffective += effective;
      } else {
        commitmentsPlanned += -item.amount;
        commitmentsEffective += -effective;
      }
    }
    return { ...item, status, actual, effective };
  });

  // Unlinked actuals — the flows the plan didn't promise.
  let extraIncome = 0;
  let discretionary = 0;
  for (const t of monthTxns) {
    if (t.plan_item_id) continue;

    if (t.type === "income") {
      extraIncome += t.amount;
      continue;
    }
    if (t.type === "transfer") {
      // Cash view: money arriving in a loan/credit/savings account is cash
      // committed (an extra debt payment, CC payment, or savings deposit).
      // We count the destination leg only, so two-sided pairs count once.
      if (
        t.amount > 0 &&
        (ctx.loanAccountIds.has(t.account_id) ||
          ctx.creditAccountIds.has(t.account_id) ||
          ctx.savingsAccountIds.has(t.account_id))
      ) {
        discretionary += t.amount;
      }
      continue;
    }
    // expense / refund via splits — cash view skips credit-card purchases
    // (the CC payment commitment carries them).
    if (ctx.creditAccountIds.has(t.account_id)) continue;
    for (const split of t.splits ?? []) discretionary += -split.amount;
  }

  const baseline = expectedIncome - commitmentsPlanned;
  const freeToSpend = incomeEffective + extraIncome - commitmentsEffective - discretionary;

  return {
    expectedIncome,
    commitmentsPlanned,
    baseline,
    incomeEffective,
    commitmentsEffective,
    extraIncome,
    discretionary,
    freeToSpend,
    items: ledgerItems,
  };
}
