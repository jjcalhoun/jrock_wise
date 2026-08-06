import type { Transaction } from "@/lib/types";
import { monthKey } from "@/lib/aggregations";
import type { Commitment, CommitmentKind } from "./types";

/* The free-to-spend ledger, over commitments.
 *
 *   expected income (commitments)
 * − commitments (planned until their transaction posts, then the actual)
 * = baseline
 * − discretionary spend (unlinked, cash-view)
 * + extra income (actual income beyond the plan)
 * = free to spend
 *
 * Two things differ from the month-plan version this replaces:
 *
 *  1. ONE source of truth. Links are `transactions.commitment_id` and nothing
 *     else — the render-time autoLinkByRule overlay is gone, so the ledger and
 *     the picker can no longer disagree about whether a bill is paid.
 *
 *  2. Dates carry little weight. A linked transaction counts toward its
 *     COMMITMENT's period, whatever date it actually posted, so a bill due the
 *     31st that clears on the 1st lands in the month that expected it. Only
 *     unlinked spending is bucketed by its own date.
 *
 * Cash view: credit-card PURCHASES don't reduce free-to-spend (the monthly card
 * payment commitment carries them). Transfers between cash accounts are neutral.
 */

export interface LedgerItem {
  id: string;
  series_id: string;
  name: string;
  kind: CommitmentKind;
  amount: number; // planned, signed
  due_hint?: string | null;
  variable: boolean;
  /** named `excluded` for continuity with the screens; stored as `skipped` */
  excluded: boolean;
  status: "expected" | "paid";
  /** signed actual from linked transactions (null until something links) */
  actual: number | null;
  /** what the ledger counts: actual when paid, planned otherwise */
  effective: number;
  /** transactions fulfilling this commitment */
  linked: Transaction[];
}

export interface Ledger {
  expectedIncome: number;
  commitmentsPlanned: number;
  baseline: number;
  incomeEffective: number;
  commitmentsEffective: number;
  extraIncome: number;
  discretionary: number;
  freeToSpend: number;
  items: LedgerItem[];
}

export interface LedgerContext {
  creditAccountIds: Set<string>;
  loanAccountIds: Set<string>;
  savingsAccountIds: Set<string>;
}

/** Signed actual from linked transactions. A two-sided transfer may have either
 *  or both legs linked; prefer the outflow legs so a pair isn't double-counted. */
function linkedActual(kind: CommitmentKind, linked: Transaction[]): number | null {
  if (linked.length === 0) return null;
  if (kind === "income") return linked.reduce((s, t) => s + t.amount, 0);
  const out = linked.filter((t) => t.amount < 0);
  const legs = out.length > 0 ? out : linked;
  return -legs.reduce((s, t) => s + Math.abs(t.amount), 0);
}

export function ledger(
  commitments: Commitment[],
  transactions: Transaction[],
  period: string,
  ctx: LedgerContext,
): Ledger {
  const inPeriod = commitments.filter((c) => c.period === period);
  const ids = new Set(inPeriod.map((c) => c.id));

  // Linked rows count toward their commitment's period regardless of date.
  const linkedByCommitment = new Map<string, Transaction[]>();
  for (const t of transactions) {
    const id = t.commitment_id;
    if (!id || !ids.has(id)) continue;
    const arr = linkedByCommitment.get(id);
    if (arr) arr.push(t);
    else linkedByCommitment.set(id, [t]);
  }

  let expectedIncome = 0;
  let commitmentsPlanned = 0;
  let incomeEffective = 0;
  let commitmentsEffective = 0;

  const items: LedgerItem[] = inPeriod.map((c) => {
    const linked = c.skipped ? [] : (linkedByCommitment.get(c.id) ?? []);
    const actual = linkedActual(c.kind, linked);
    const effective = c.skipped ? 0 : (actual ?? c.amount);
    if (!c.skipped) {
      if (c.kind === "income") {
        expectedIncome += c.amount;
        incomeEffective += effective;
      } else {
        commitmentsPlanned += -c.amount;
        commitmentsEffective += -effective;
      }
    }
    return {
      id: c.id,
      series_id: c.series_id,
      name: c.name,
      kind: c.kind,
      amount: c.amount,
      due_hint: c.due_hint,
      variable: c.variable,
      excluded: c.skipped,
      status: actual !== null ? "paid" : "expected",
      actual,
      effective,
      linked,
    };
  });

  // Unlinked actuals — the flows nothing promised — bucketed by their own date.
  let extraIncome = 0;
  let discretionary = 0;
  for (const t of transactions) {
    if (t.commitment_id) continue;
    if (monthKey(t.date) !== period) continue;

    if (t.type === "income") {
      extraIncome += t.amount;
      continue;
    }
    if (t.type === "transfer") {
      // Cash view: money landing in a loan/credit/savings account is cash
      // committed. Count the destination leg only, so a pair counts once.
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
    // Expense / refund via splits. The cash view skips anything charged to a
    // LIABILITY account, because no cash left your pocket when it posted:
    //   - credit-card purchases are carried by the monthly card payment;
    //   - interest and escrow on a loan are consequences of a payment that
    //     already counted, so counting their splits again would double-charge
    //     free-to-spend. They still reach the category rollup, which is what
    //     puts mortgage escrow in Housing without inflating spending.
    if (ctx.creditAccountIds.has(t.account_id) || ctx.loanAccountIds.has(t.account_id)) continue;
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
    items,
  };
}
