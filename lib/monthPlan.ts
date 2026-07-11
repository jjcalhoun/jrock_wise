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

/* ---------- matching: suggestions + deterministic auto-links ---------- */

/** Deterministic links for rule-generated transactions: a row whose
 *  external_id is `recurring:<ruleId>:<date>` fulfills the plan item drafted
 *  from that rule for that due date (falling back to same-month when the date
 *  drifted). These never need user confirmation. */
export function autoLinkByRule(
  items: MonthPlanItem[],
  transactions: Transaction[],
): Map<string, string> {
  const byRuleDate = new Map<string, MonthPlanItem>();
  const byRuleMonth = new Map<string, MonthPlanItem[]>();
  for (const i of items) {
    if (!i.rule_id || i.excluded) continue;
    if (i.due_date) byRuleDate.set(`${i.rule_id}|${i.due_date}`, i);
    const mk = i.due_date ? i.due_date.slice(0, 7) : "";
    const arr = byRuleMonth.get(`${i.rule_id}|${mk}`);
    if (arr) arr.push(i);
    else byRuleMonth.set(`${i.rule_id}|${mk}`, [i]);
  }

  const links = new Map<string, string>();
  const taken = new Set<string>();
  // A two-sided pair shares one item: legs carry external_id `X` and `X:c`,
  // so remember the assignment under the base id and let the twin reuse it.
  const byPair = new Map<string, string>();
  for (const t of transactions) {
    if (t.plan_item_id) continue; // already explicitly linked
    const ext = t.external_id ?? "";
    const m = /^recurring:([^:]+):(\d{4}-\d{2}-\d{2})/.exec(ext);
    if (!m) continue;
    const base = ext.endsWith(":c") ? ext.slice(0, -2) : ext;

    const paired = byPair.get(base);
    if (paired) {
      links.set(t.id, paired);
      continue;
    }
    const exact = byRuleDate.get(`${m[1]}|${m[2]}`);
    const candidate =
      exact && !taken.has(exact.id)
        ? exact
        : (byRuleMonth.get(`${m[1]}|${m[2].slice(0, 7)}`) ?? []).find((i) => !taken.has(i.id));
    if (!candidate) continue;
    links.set(t.id, candidate.id);
    taken.add(candidate.id);
    byPair.set(base, candidate.id);
  }
  return links;
}

/** Suggest the open plan item a transaction most likely fulfills (for review
 *  to confirm — suggestions are never applied silently). */
export function suggestPlanItem(
  txn: Transaction,
  items: MonthPlanItem[],
  openItemIds: Set<string>,
  amountTolPct = 15,
): MonthPlanItem | null {
  const inflow = txn.amount > 0;
  const mTxn = norm(txn.merchant || txn.description || "");
  let best: MonthPlanItem | null = null;
  let bestDiff = Infinity;
  for (const item of items) {
    if (item.excluded || !openItemIds.has(item.id)) continue;
    if (inflow !== (item.kind === "income")) continue;
    const planned = Math.abs(item.amount);
    const diff = Math.abs(Math.abs(txn.amount) - planned);
    const withinAmount = planned > 0 && diff <= (planned * amountTolPct) / 100;
    const mItem = norm(item.name);
    const nameHit = !!mTxn && !!mItem && (mTxn === mItem || mTxn.includes(mItem) || mItem.includes(mTxn));
    // income: amount alone is enough (deposit descriptors rarely match names);
    // outgoing: require the name unless the amount is exact to the cent
    const ok = item.kind === "income" ? withinAmount : (nameHit && withinAmount) || diff < 0.005;
    if (ok && diff < bestDiff) {
      best = item;
      bestDiff = diff;
    }
  }
  return best;
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
  /** extra txn→item links (e.g. autoLinkByRule) applied on top of plan_item_id */
  linkOverlay?: Map<string, string>,
): Ledger {
  const monthTxns = transactions.filter((t) => monthKey(t.date) === month);

  const linkOf = (t: Transaction) => t.plan_item_id ?? linkOverlay?.get(t.id) ?? null;

  const linkedByItem = new Map<string, Transaction[]>();
  for (const t of monthTxns) {
    const itemId = linkOf(t);
    if (!itemId) continue;
    const arr = linkedByItem.get(itemId);
    if (arr) arr.push(t);
    else linkedByItem.set(itemId, [t]);
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
    if (linkOf(t)) continue;

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
