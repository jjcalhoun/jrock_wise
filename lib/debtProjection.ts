import { type DebtStrategy, minPayment as estMinPayment } from "@/lib/debt";

/* Month-by-month projection for the Debt planner. Simulates paying off debts
   (avalanche/snowball) while a monthly surplus is split into savings,
   investments, and extra debt paydown — then projects savings, investments,
   total debt, and net worth over time.

   Model:
   - Each debt keeps its own minimum; the constant debt pool = sum of starting
     minimums + the extra-debt slice, so a freed minimum rolls into the next
     debt (strategy order).
   - Savings grows by its slice; investments grows by its slice + monthly return.
   - Checking is held flat (spending money, not projected).
   - Once debt-free, the whole freed pool redirects to savings.
   - The horizon runs to the debt-free month plus a buffer (dynamic). */

export interface ProjDebt {
  id: string;
  name: string;
  balance: number; // positive owed
  apr: number;
  minPayment: number;
}

export interface ProjInput {
  debts: ProjDebt[];
  strategy: DebtStrategy;
  monthlySurplus: number;
  savingsPct: number;
  investmentsPct: number; // extra-debt % = 100 - savings - investments
  startChecking: number;
  startSavings: number;
  startInvestments: number;
  investReturnPct: number;
  bufferMonths?: number;
}

export interface ProjPoint {
  month: number;
  debt: Record<string, number>;
  totalDebt: number;
  savings: number;
  investments: number;
  checking: number;
  netWorth: number;
}

export interface ProjPayoff {
  id: string;
  name: string;
  balance: number;
  apr: number;
  monthsToClear: number;
}

export interface Projection {
  points: ProjPoint[];
  order: ProjPayoff[];
  debtFreeMonth: number; // 0 = already debt-free
}

const MAX_MONTHS = 600;

const orderDebts = (debts: ProjDebt[], strategy: DebtStrategy) =>
  [...debts].sort((a, b) => (strategy === "avalanche" ? b.apr - a.apr : a.balance - b.balance));

export function projectDebt(input: ProjInput): Projection {
  const {
    debts,
    strategy,
    monthlySurplus,
    savingsPct,
    investmentsPct,
    startChecking,
    startSavings,
    startInvestments,
    investReturnPct,
    bufferMonths = 24,
  } = input;

  const active = debts.filter((d) => d.balance > 0.005);
  const ordered = orderDebts(active, strategy);
  const bal: Record<string, number> = {};
  for (const d of active) bal[d.id] = d.balance;

  const minOf = (d: ProjDebt) => (d.minPayment && d.minPayment > 0 ? d.minPayment : estMinPayment(d.balance));
  const startMinSum = active.reduce((s, d) => s + minOf(d), 0);

  const surplus = Math.max(0, monthlySurplus);
  const sPct = Math.max(0, savingsPct);
  const iPct = Math.max(0, investmentsPct);
  const dPct = Math.max(0, 100 - sPct - iPct);
  const toSavings = (surplus * sPct) / 100;
  const toInvest = (surplus * iPct) / 100;
  const toExtraDebt = (surplus * dPct) / 100;
  const debtPool = startMinSum + toExtraDebt;
  const monthlyReturn = investReturnPct / 1200;

  let savings = startSavings;
  let investments = startInvestments;
  const checking = startChecking;

  const totalOf = () => ordered.reduce((s, d) => s + Math.max(0, bal[d.id]), 0);
  const snapshot = (month: number): ProjPoint => {
    const debt: Record<string, number> = {};
    for (const d of ordered) debt[d.id] = Math.max(0, bal[d.id]);
    const totalDebt = totalOf();
    return {
      month,
      debt,
      totalDebt,
      savings,
      investments,
      checking,
      netWorth: checking + savings + investments - totalDebt,
    };
  };

  const clearedAt: Record<string, number> = {};
  const points: ProjPoint[] = [snapshot(0)];
  let debtFreeMonth = ordered.length === 0 ? 0 : -1;
  let month = 0;

  while (month < MAX_MONTHS) {
    month++;
    const debtsRemain = ordered.some((d) => bal[d.id] > 0.005);

    if (debtsRemain) {
      for (const d of ordered) {
        if (bal[d.id] > 0.005) bal[d.id] += (bal[d.id] * d.apr) / 1200;
      }
      let cash = debtPool;
      for (const d of ordered) {
        if (bal[d.id] > 0.005 && cash > 0) {
          const pay = Math.min(bal[d.id], minOf(d), cash);
          bal[d.id] -= pay;
          cash -= pay;
        }
      }
      for (const d of ordered) {
        if (cash <= 0) break;
        if (bal[d.id] > 0.005) {
          const pay = Math.min(bal[d.id], cash);
          bal[d.id] -= pay;
          cash -= pay;
        }
      }
      for (const d of ordered) {
        if (bal[d.id] <= 0.005 && clearedAt[d.id] === undefined) clearedAt[d.id] = month;
      }
      // leftover debt cash (once everything's cleared this month) → savings
      savings += toSavings + Math.max(0, cash);
      investments = investments * (1 + monthlyReturn) + toInvest;
      if (debtFreeMonth < 0 && ordered.every((d) => bal[d.id] <= 0.005)) debtFreeMonth = month;
    } else {
      // debt-free: the whole freed pool redirects to savings
      savings += toSavings + debtPool;
      investments = investments * (1 + monthlyReturn) + toInvest;
    }

    points.push(snapshot(month));

    if (debtFreeMonth >= 0 && month >= debtFreeMonth + bufferMonths) break;
  }

  const order: ProjPayoff[] = ordered.map((d) => ({
    id: d.id,
    name: d.name,
    balance: d.balance,
    apr: d.apr,
    monthsToClear: clearedAt[d.id] ?? month,
  }));

  return { points, order, debtFreeMonth: debtFreeMonth < 0 ? month : debtFreeMonth };
}
