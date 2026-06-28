/**
 * Debt payoff planner — avalanche (highest APR first) and snowball
 * (smallest balance first) strategies with a month-by-month simulation.
 *
 * Schema has no per-account minimum payment, so we estimate one as
 * max($25, 2% of the current balance) — a common credit-card convention.
 * A constant monthly "pool" (sum of starting minimums + your extra payment)
 * is applied each month: minimums on everything, then the remainder thrown
 * at the focus debt chosen by the strategy.
 */

export type DebtStrategy = "avalanche" | "snowball";

export interface DebtInput {
  id: string;
  name: string;
  balance: number; // positive = amount owed
  apr: number; // annual %, e.g. 22.99
}

export interface DebtPayoff extends DebtInput {
  monthsToClear: number; // months until this debt hits zero
}

export interface PayoffPlan {
  order: DebtPayoff[];
  totalMonths: number;
  totalInterest: number;
}

const MIN_FLOOR = 25;
const MIN_RATE = 0.02;
const MAX_MONTHS = 600; // 50-year safety cap

export function minPayment(balance: number): number {
  return Math.min(balance, Math.max(MIN_FLOOR, balance * MIN_RATE));
}

function orderDebts(debts: DebtInput[], strategy: DebtStrategy): DebtInput[] {
  return [...debts].sort((a, b) =>
    strategy === "avalanche" ? b.apr - a.apr : a.balance - b.balance,
  );
}

export function planPayoff(
  debts: DebtInput[],
  extra: number,
  strategy: DebtStrategy,
): PayoffPlan {
  const active = debts.filter((d) => d.balance > 0.005);
  const ordered = orderDebts(active, strategy);

  if (ordered.length === 0) {
    return { order: [], totalMonths: 0, totalInterest: 0 };
  }

  const bal: Record<string, number> = {};
  for (const d of active) bal[d.id] = d.balance;

  // Constant monthly pool, based on starting balances.
  const pool =
    active.reduce((s, d) => s + minPayment(d.balance), 0) + Math.max(0, extra);

  const clearedAt: Record<string, number> = {};
  let totalInterest = 0;
  let month = 0;

  while (ordered.some((d) => bal[d.id] > 0.005) && month < MAX_MONTHS) {
    month++;

    // 1. accrue interest
    for (const d of ordered) {
      if (bal[d.id] > 0.005) {
        const interest = (bal[d.id] * d.apr) / 1200;
        bal[d.id] += interest;
        totalInterest += interest;
      }
    }

    // 2. pay minimums on every active debt
    let cash = pool;
    for (const d of ordered) {
      if (bal[d.id] > 0.005) {
        const pay = Math.min(bal[d.id], minPayment(bal[d.id]), cash);
        bal[d.id] -= pay;
        cash -= pay;
      }
    }

    // 3. throw the remainder at the focus debt(s), in strategy order
    for (const d of ordered) {
      if (cash <= 0) break;
      if (bal[d.id] > 0.005) {
        const pay = Math.min(bal[d.id], cash);
        bal[d.id] -= pay;
        cash -= pay;
      }
    }

    // 4. record any newly-cleared debts
    for (const d of ordered) {
      if (bal[d.id] <= 0.005 && clearedAt[d.id] === undefined) {
        clearedAt[d.id] = month;
      }
    }
  }

  const order: DebtPayoff[] = ordered.map((d) => ({
    ...d,
    monthsToClear: clearedAt[d.id] ?? month,
  }));

  return {
    order,
    totalMonths: month,
    totalInterest: Math.round(totalInterest * 100) / 100,
  };
}
