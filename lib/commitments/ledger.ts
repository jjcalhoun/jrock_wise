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
 * TWO VIEWS OF A CREDIT CARD, and the whole point is that they never overlap.
 *
 *   CASH  — when did money leave your pocket? A card purchase doesn't reduce
 *           free-to-spend; the monthly card payment does. True to your bank
 *           balance, but a week of swiping shows up as nothing at all, and
 *           spending on a card with no payment line vanishes entirely.
 *
 *   SPEND — what have you committed this month? A card purchase reduces
 *           free-to-spend the moment it posts, and the card payment then counts
 *           ZERO, because charging it and paying it are one event seen twice.
 *
 * The invariant is that exactly one of the pair is counted, never both and
 * never neither. Counting both charges you twice for one dinner; counting
 * neither is the hole that made $316 of card spending invisible.
 *
 * LOAN accounts are excluded from spending in BOTH views. Interest and escrow
 * post as charges against the loan, but they are consequences of a payment
 * that already counted — they belong in the category rollup (so escrow shows
 * under Housing) and nowhere near free-to-spend.
 *
 * Transfers between cash accounts are neutral in both.
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
  /** settled by a payment that primarily fulfills another occurrence */
  coveredBy?: string | null;
  /** a card payment counting zero because its purchases were counted instead */
  carried?: boolean;
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

export interface LedgerOptions {
  /** SPEND view: count card purchases when they post, and stop counting the
   *  card payment that would otherwise carry them. Default false (cash view). */
  countCardPurchases?: boolean;
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
  opts: LedgerOptions = {},
): Ledger {
  const spendView = opts.countCardPurchases ?? false;
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
    // A week settled by someone else's lump payment counts ZERO here: the
    // primary line carries the whole amount, so the cash lands once.
    const covered = !!c.covered_by;
    // In the spend view the purchases already counted, so counting the payment
    // too would charge the same dinner twice.
    const carried = spendView && c.kind === "cc_payment";
    const actual = covered ? 0 : linkedActual(c.kind, linked);
    const effective = c.skipped || covered || carried ? 0 : (actual ?? c.amount);
    if (!c.skipped && !covered && !carried) {
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
      coveredBy: c.covered_by ?? null,
      carried,
      status: covered || actual !== null ? "paid" : "expected",
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
      // Money landing in a loan/credit/savings account is cash committed.
      // Count the destination leg only, so a pair counts once. A card payment
      // is skipped in the spend view for the same reason its commitment is:
      // the purchases it settles have already been counted.
      const toCard = ctx.creditAccountIds.has(t.account_id);
      if (
        t.amount > 0 &&
        !(spendView && toCard) &&
        (ctx.loanAccountIds.has(t.account_id) ||
          toCard ||
          ctx.savingsAccountIds.has(t.account_id))
      ) {
        discretionary += t.amount;
      }
      continue;
    }
    // Expense / refund via splits.
    //
    // A LOAN account is skipped in both views: interest and escrow are
    // consequences of a payment that already counted, so counting their splits
    // again would double-charge free-to-spend. They still reach the category
    // rollup, which is what puts mortgage escrow under Housing without
    // inflating spending.
    if (ctx.loanAccountIds.has(t.account_id)) continue;
    // A CARD purchase counts in the spend view and not in the cash one — the
    // card payment takes the opposite side of that trade above.
    if (!spendView && ctx.creditAccountIds.has(t.account_id)) continue;
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
