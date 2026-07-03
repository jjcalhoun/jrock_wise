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
import { rollup, cashOut } from "@/lib/aggregations";
import { fmt, fmt0, monthLabel, currentMonthKey, addMonth } from "@/lib/format";
import { BUCKETS } from "@/lib/buckets";
import { Card } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Gauge } from "@/components/insights/Gauge";
import { CategoryDetail } from "@/components/insights/CategoryDetail";
import { CashOutDetail } from "@/components/insights/CashOutDetail";
import type { CashOutSegment } from "@/lib/aggregations";
import { GaugeLoader } from "@/components/ui/GaugeLoader";
import type { BucketType, Category } from "@/lib/types";

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
  const [cashDetail, setCashDetail] = useState<CashOutSegment | null>(null);
  const [view, setView] = useState<"budget" | "cashout">("budget");

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

  // "Cash out" lens — where money actually left your accounts this month.
  const accountType = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.type])),
    [accounts],
  );
  const accountNameById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );
  const cash = useMemo(
    () => cashOut(transactions, accountType, categoryById, month),
    [transactions, accountType, categoryById, month],
  );
  const cashSegments = cash.segments.map((s) => ({ color: s.color, value: s.value, icon: s.icon }));

  const income = budget?.income ?? 0;
  const available = isCurrent ? income - roll.spend : roll.income - roll.spend;

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
      {/* Budget / Cash-out toggle */}
      <div
        className="inline-flex p-0.5 rounded-full text-xs font-semibold"
        style={{ background: "var(--color-chip-bg)" }}
      >
        {([["budget", "Budget"], ["cashout", "Cash out"]] as const).map(([v, lbl]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="px-3 py-1.5 rounded-full transition-colors"
            style={{
              background: view === v ? "var(--color-primary)" : "transparent",
              color: view === v ? "#fff" : "var(--color-muted)",
            }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* Gauge */}
      <Card className="px-3 pt-3 pb-2">
        {view === "budget" ? (
          <Gauge segments={gaugeSegments} spent={roll.spend} budget={gaugeBudget} />
        ) : (
          <Gauge
            segments={cashSegments}
            spent={cash.total}
            budget={roll.income}
            label="Cash out"
            budgetLabel="income"
          />
        )}
      </Card>

      {/* Cash-out breakdown — itemizes where money left, incl. debt payments */}
      {view === "cashout" && (
        <Card className="p-4 space-y-2.5">
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            Where your cash went{cash.total === 0 ? " — no cash movement this month" : ""}
          </p>
          {cash.segments.map((s) => (
            <button
              key={s.key}
              onClick={() => setCashDetail(s)}
              className="w-full flex items-center gap-2.5 text-left active:opacity-70"
            >
              <span
                className="inline-flex items-center justify-center w-7 h-7 rounded-full shrink-0"
                style={{ background: `${s.color}22` }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: s.color }}>
                  {s.icon}
                </span>
              </span>
              <span className="text-sm flex-1 truncate" style={{ color: "var(--color-text)" }}>
                {s.label}
              </span>
              <span className="font-figure text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                {fmt(s.value)}
              </span>
              <span className="material-symbols-outlined shrink-0" style={{ fontSize: 16, color: "var(--color-faint)" }}>
                chevron_right
              </span>
            </button>
          ))}
          <p className="text-[11px] pt-1" style={{ color: "var(--color-faint)" }}>
            Cash that left your checking, savings & cash accounts. Credit-card
            purchases aren’t here — they show up when you pay the card.
          </p>
        </Card>
      )}

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
        </div>{/* left column */}

        <div className="space-y-5">
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

        </div>{/* right column */}
      </div>{/* dashboard grid */}

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
      {cashDetail && (
        <CashOutDetail
          segment={cashDetail}
          transactions={cash.txnsByKey[cashDetail.key] ?? []}
          month={month}
          accountNameById={accountNameById}
          onClose={() => setCashDetail(null)}
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
