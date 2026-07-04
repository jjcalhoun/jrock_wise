"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useTransactions,
  useCategories,
  useAccounts,
  useBudget,
  useCategoryBudgets,
} from "@/hooks/useSupabaseData";
import { useTxnWindow } from "@/components/providers";
import { rollup, loanPaydown, monthKey } from "@/lib/aggregations";
import { predictMonth } from "@/lib/predict";
import { useRecurringRules } from "@/hooks/useRecurring";
import { fmt, fmt0, monthLabel, currentMonthKey, addMonth } from "@/lib/format";
import { BUCKETS } from "@/lib/buckets";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Gauge, type GaugePetal } from "@/components/insights/Gauge";
import { CategoryDetail } from "@/components/insights/CategoryDetail";
import { SegmentDetail, type DetailSegment } from "@/components/insights/SegmentDetail";
import { GaugeLoader } from "@/components/ui/GaugeLoader";
import type { BucketType, Category } from "@/lib/types";

const DEBT_PETAL = { color: "#F97316", icon: "account_balance", label: "Debt payments" };

export function InsightsScreen() {
  const { data: transactions = [], isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const { data: budget } = useBudget();
  const { data: categoryBudgets = {} } = useCategoryBudgets();

  const { ensureSince } = useTxnWindow();
  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const [detail, setDetail] = useState<Category | null>(null);
  const [debtOpen, setDebtOpen] = useState(false);

  const isCurrent = month === thisMonth;
  const canGoForward = month < thisMonth;

  // the category detail shows a 7-month history, so load 6 months before too
  useEffect(() => {
    ensureSince(`${addMonth(month, -6)}-01`);
  }, [month, ensureSince]);

  const savingsIds = useMemo(
    () => new Set(accounts.filter((a) => a.type === "savings").map((a) => a.id)),
    [accounts],
  );
  const loanIds = useMemo(
    () => new Set(accounts.filter((a) => a.type === "loan").map((a) => a.id)),
    [accounts],
  );
  const roll = useMemo(
    () => rollup(transactions, month, undefined, savingsIds, loanIds),
    [transactions, month, savingsIds, loanIds],
  );
  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );
  const accountNameById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  const { data: rules = [] } = useRecurringRules();

  // Income: actual for past months; predicted for the current month (received
  // so far + what's still to come from recurring rules), matching Home. Falls
  // back to the manual estimate only when there are no recurring income rules.
  const pred = useMemo(
    () => (isCurrent ? predictMonth(rules, transactions, month) : null),
    [isCurrent, rules, transactions, month],
  );
  const hasIncomeRule = rules.some((r) => r.active && r.type === "income");
  const income = !isCurrent
    ? roll.income
    : hasIncomeRule
      ? roll.income + (pred?.income ?? 0)
      : Math.max(roll.income, budget?.income ?? 0);
  const projSpend = roll.spend + (pred?.spend ?? 0);
  const available = isCurrent ? income - projSpend : roll.income - roll.spend;
  // Current-month breakdown: what's free after spending so far, less the
  // recurring bills still expected this month.
  const availableNow = income - roll.spend;
  const expectedRecurring = pred?.spend ?? 0;

  // 3-month averages (the 3 completed months before the selected one).
  const avg3ByCat = useMemo(() => {
    const acc: Record<string, number> = {};
    for (let i = 1; i <= 3; i++) {
      const r = rollup(transactions, addMonth(month, -i), undefined, savingsIds, loanIds);
      for (const [id, v] of Object.entries(r.byCat)) if (v > 0) acc[id] = (acc[id] ?? 0) + v;
    }
    const out: Record<string, number> = {};
    for (const id in acc) out[id] = acc[id] / 3;
    return out;
  }, [transactions, month, savingsIds, loanIds]);

  // Debt: actual = this month's loan paydowns; budget = sum of loan min payments.
  const debt = useMemo(() => {
    const loans = accounts.filter((a) => a.type === "loan");
    const byAccount: Record<string, number> = {};
    const txns = [];
    for (const t of transactions) {
      if (monthKey(t.date) !== month) continue;
      if (t.type === "transfer" && t.amount > 0 && loanIds.has(t.account_id)) {
        byAccount[t.account_id] = (byAccount[t.account_id] ?? 0) + t.amount;
        txns.push(t);
      }
    }
    const actual = Object.values(byAccount).reduce((s, v) => s + v, 0);
    const budgetAmt = loans.reduce((s, a) => s + (a.min_payment ?? 0), 0);
    let avg = 0;
    for (let i = 1; i <= 3; i++) avg += loanPaydown(transactions, loanIds, addMonth(month, -i));
    const breakdown = loans
      .filter((a) => (byAccount[a.id] ?? 0) > 0)
      .map((a) => ({ label: a.name, value: byAccount[a.id] }))
      .sort((x, y) => y.value - x.value);
    return { actual, budget: budgetAmt, avg3: avg / 3, breakdown, txns };
  }, [transactions, accounts, loanIds, month]);

  // Petals: only categories with actual spending this month, plus a combined
  // Debt payments petal when there were payments. (No spend → no petal.)
  const petals: GaugePetal[] = useMemo(() => {
    const keys = new Set(Object.keys(roll.byCat).filter((id) => roll.byCat[id] > 0));
    const cat: GaugePetal[] = [...keys].flatMap((id) => {
      const c = categoryById[id];
      if (!c) return [];
      return [{
        key: `cat:${id}`,
        label: c.name,
        color: c.color,
        icon: c.icon,
        actual: Math.max(0, roll.byCat[id] ?? 0),
        budget: categoryBudgets[id] ?? 0,
        avg3: avg3ByCat[id] ?? 0,
      }];
    });
    if (debt.actual > 0) {
      cat.push({
        key: "debt",
        ...DEBT_PETAL,
        actual: debt.actual,
        budget: debt.budget,
        avg3: debt.avg3,
        breakdown: debt.breakdown,
      });
    }
    return cat;
  }, [categoryBudgets, roll.byCat, categoryById, avg3ByCat, debt]);

  const ranked = useMemo(() => {
    return Object.entries(roll.byCat)
      .map(([id, spend]) => ({ cat: categoryById[id], spend }))
      .filter((r) => r.cat && r.spend > 0)
      .sort((a, b) => b.spend - a.spend);
  }, [roll.byCat, categoryById]);

  function onPetalClick(key: string) {
    if (key === "debt") return setDebtOpen(true);
    const c = categoryById[key.slice(4)];
    if (c) setDetail(c);
  }

  const hasContent = petals.length > 0;

  if (isLoading) return <GaugeLoader />;

  return (
    <main className="p-4 space-y-5">
      {/* Month navigator */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setMonth(addMonth(month, -1))}
          style={{ color: "var(--color-muted)" }}
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </button>
        <h1 className="font-figure text-lg font-bold" style={{ color: "var(--color-text)" }}>
          {monthLabel(month)}
        </h1>
        <button
          onClick={() => canGoForward && setMonth(addMonth(month, 1))}
          disabled={!canGoForward}
          style={{ color: canGoForward ? "var(--color-muted)" : "var(--color-hairline)" }}
        >
          <span className="material-symbols-outlined">chevron_right</span>
        </button>
      </div>

      {/* Two-column dashboard on desktop */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start space-y-5 lg:space-y-0">
        <div className="space-y-5">
      {/* Budget arc — plan vs actual, incl. debt payments */}
      <Card className="px-3 pt-3 pb-2">
        <Gauge petals={petals} income={income || roll.spend} onPetalClick={onPetalClick} />
      </Card>

      {/* Available / Net card */}
      <Card className="p-4">
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          {isCurrent ? "Available to spend, save, or pay debt" : "Net — available to save or pay debt"}
        </p>
        <p
          className="font-figure text-3xl font-bold mt-1"
          style={{ color: available >= 0 ? "var(--color-positive)" : "var(--color-danger)" }}
        >
          {fmt(available)}
        </p>
        {isCurrent && expectedRecurring > 0 && (
          <p className="text-xs mt-1.5" style={{ color: "var(--color-faint)" }}>
            {fmt(availableNow)} now, less {fmt0(expectedRecurring)} in expected recurring payments
          </p>
        )}
      </Card>

      {/* Cash flow */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Cash flow
        </h2>
        <Card className="p-4 space-y-3">
          <FlowBar label="Income" value={income} max={Math.max(income, roll.spend, 1)} color="var(--color-positive)" />
          {(Object.keys(BUCKETS) as BucketType[]).map((b) => (
            <FlowBar
              key={b}
              label={BUCKETS[b].label}
              value={roll.byBucket[b]}
              max={Math.max(income, roll.spend, 1)}
              color={BUCKETS[b].color}
            />
          ))}
        </Card>
      </section>
        </div>{/* left column */}

        <div className="space-y-5">
      {/* Spending categories */}
      {(ranked.length > 0 || debt.actual > 0) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Spending categories
          </h2>
          <Card className="p-2">
            {debt.actual > 0 && (
              <button onClick={() => setDebtOpen(true)} className="w-full text-left px-2 py-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-2 text-sm">
                    <span
                      className="inline-flex items-center justify-center w-6 h-6 rounded-full"
                      style={{ background: `${DEBT_PETAL.color}22` }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14, color: DEBT_PETAL.color }}>
                        {DEBT_PETAL.icon}
                      </span>
                    </span>
                    <span style={{ color: "var(--color-text)" }}>{DEBT_PETAL.label}</span>
                  </span>
                  <span className="text-sm font-figure" style={{ color: debt.budget > 0 && debt.actual > debt.budget ? "var(--color-danger)" : "var(--color-text)" }}>
                    {fmt0(debt.actual)}
                    {debt.budget > 0 && <span style={{ color: "var(--color-faint)" }}> / {fmt0(debt.budget)}</span>}
                  </span>
                </div>
                {debt.budget > 0 && (
                  <ProgressBar value={(debt.actual / debt.budget) * 100} color={DEBT_PETAL.color} overBudget={debt.actual > debt.budget} />
                )}
              </button>
            )}
            {ranked.map(({ cat, spend }) => {
              const target = categoryBudgets[cat.id] ?? 0;
              const pct = target > 0 ? (spend / target) * 100 : 0;
              const over = target > 0 && spend > target;
              return (
                <button
                  key={cat.id}
                  onClick={() => setDetail(cat)}
                  className="w-full text-left px-2 py-2.5"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="flex items-center gap-2 text-sm">
                      <span
                        className="inline-flex items-center justify-center w-6 h-6 rounded-full"
                        style={{ background: `${cat.color}22` }}
                      >
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: 14, color: cat.color }}
                        >
                          {cat.icon}
                        </span>
                      </span>
                      <span style={{ color: "var(--color-text)" }}>{cat.name}</span>
                    </span>
                    <span className="text-sm font-figure" style={{ color: over ? "var(--color-danger)" : "var(--color-text)" }}>
                      {fmt0(spend)}
                      {target > 0 && (
                        <span style={{ color: "var(--color-faint)" }}> / {fmt0(target)}</span>
                      )}
                    </span>
                  </div>
                  {target > 0 && (
                    <ProgressBar value={pct} color={cat.color} overBudget={over} />
                  )}
                </button>
              );
            })}
          </Card>
        </section>
      )}

        </div>{/* right column */}
      </div>{/* dashboard grid */}

      {!hasContent && (
        <p className="text-sm text-center py-4" style={{ color: "var(--color-muted)" }}>
          No spending or budget set for {monthLabel(month)}.
        </p>
      )}

      {detail && (
        <CategoryDetail
          category={detail}
          transactions={transactions}
          month={month}
          monthlyTarget={categoryBudgets[detail.id] ?? 0}
          onClose={() => setDetail(null)}
        />
      )}
      {debtOpen && (
        <SegmentDetail
          segment={{ ...DEBT_PETAL, value: debt.actual } as DetailSegment}
          transactions={debt.txns}
          month={month}
          accountNameById={accountNameById}
          breakdown={debt.breakdown}
          onClose={() => setDebtOpen(false)}
        />
      )}
    </main>
  );
}

function FlowBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs w-16" style={{ color: "var(--color-muted)" }}>
        {label}
      </span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--color-hairline)" }}>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, (Math.max(0, value) / max) * 100)}%`, background: color }}
        />
      </div>
      <span className="text-xs font-figure w-16 text-right" style={{ color: "var(--color-text)" }}>
        {fmt0(value)}
      </span>
    </div>
  );
}
