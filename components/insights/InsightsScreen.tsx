"use client";

import { useMemo, useState } from "react";
import {
  useTransactions,
  useCategories,
  useBudget,
  useCategoryBudgets,
} from "@/hooks/useSupabaseData";
import { rollup } from "@/lib/aggregations";
import { fmt, fmt0, monthLabel, currentMonthKey } from "@/lib/format";
import { BUCKETS } from "@/lib/buckets";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Gauge } from "@/components/insights/Gauge";
import { CategoryDetail } from "@/components/insights/CategoryDetail";
import type { BucketType, Category } from "@/lib/types";

function addMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function InsightsScreen() {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: budget } = useBudget();
  const { data: categoryBudgets = {} } = useCategoryBudgets();

  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const [detail, setDetail] = useState<Category | null>(null);

  const isCurrent = month === thisMonth;
  const canGoForward = month < thisMonth;

  const roll = useMemo(() => rollup(transactions, month), [transactions, month]);
  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  // budget Y for the gauge: sum of category targets, else estimated income
  const totalCatBudget = Object.values(categoryBudgets).reduce((s, v) => s + v, 0);
  const gaugeBudget = totalCatBudget > 0 ? totalCatBudget : budget?.income ?? 0;

  const ranked = useMemo(() => {
    return Object.entries(roll.byCat)
      .map(([id, spend]) => ({ cat: categoryById[id], spend }))
      .filter((r) => r.cat && r.spend > 0)
      .sort((a, b) => b.spend - a.spend);
  }, [roll.byCat, categoryById]);

  const gaugeSegments = ranked.map((r) => ({
    color: r.cat.color,
    value: r.spend,
    icon: r.cat.icon,
  }));

  const income = budget?.income ?? 0;
  const available = isCurrent ? income - roll.spend : roll.income - roll.spend;

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

      {/* Gauge */}
      <Card className="p-4 flex justify-center">
        <Gauge segments={gaugeSegments} spent={roll.spend} budget={gaugeBudget} />
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
      </Card>

      {/* Spending categories */}
      {ranked.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Spending categories
          </h2>
          <Card className="p-2">
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

      {/* Cash flow */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Cash flow
        </h2>
        <Card className="p-4 space-y-3">
          <FlowBar label="Income" value={roll.income} max={Math.max(roll.income, roll.spend, 1)} color="var(--color-positive)" />
          {(Object.keys(BUCKETS) as BucketType[]).map((b) => (
            <FlowBar
              key={b}
              label={BUCKETS[b].label}
              value={roll.byBucket[b]}
              max={Math.max(roll.income, roll.spend, 1)}
              color={BUCKETS[b].color}
            />
          ))}
        </Card>
      </section>

      {ranked.length === 0 && (
        <p className="text-sm text-center py-4" style={{ color: "var(--color-muted)" }}>
          No spending recorded for {monthLabel(month)}.
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
