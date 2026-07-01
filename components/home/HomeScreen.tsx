"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  useAccounts,
  useCategories,
  useTransactions,
  useBudget,
  useAccountBalances,
} from "@/hooks/useSupabaseData";
import { useTxnWindow } from "@/components/providers";
import { rollup } from "@/lib/aggregations";
import { fmt0, fmt, currentMonthKey, monthLabel, addMonth } from "@/lib/format";
import { BUCKETS } from "@/lib/buckets";
import { TxnTile } from "@/components/transactions/TxnTile";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { GaugeLoader } from "@/components/ui/GaugeLoader";
import { AccountEditor } from "@/components/settings/AccountEditor";
import { NewTransaction } from "@/components/transactions/NewTransaction";
import { TransactionEditor } from "@/components/transactions/TransactionEditor";
import { ReviewFlow } from "@/components/review/ReviewFlow";
import type { BucketType, Transaction } from "@/lib/types";

export function HomeScreen() {
  const router = useRouter();
  const { data: accounts = [], isLoading: la } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: transactions = [], isLoading: lt } = useTransactions();
  const { data: budget } = useBudget();
  const { data: balances = {} } = useAccountBalances();
  const { ensureSince } = useTxnWindow();
  const [sheet, setSheet] = useState<"account" | "txn" | null>(null);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const [showReview, setShowReview] = useState(false);

  const thisMonth = currentMonthKey();
  const [month, setMonth] = useState(thisMonth);
  const isCurrent = month === thisMonth;
  const canGoForward = month < thisMonth;

  // make sure the selected month is loaded
  useEffect(() => ensureSince(`${month}-01`), [month, ensureSince]);

  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const netCash = accounts.reduce((s, a) => s + (balances[a.id] ?? 0), 0);

  const roll = useMemo(() => rollup(transactions, month), [transactions, month]);
  const income = budget?.income ?? 0;
  // current month → "safe to spend" (expected income − spent); past → actual net
  const heroValue = isCurrent ? Math.max(0, income - roll.spend) : roll.income - roll.spend;
  const heroLabel = isCurrent ? "Safe to spend" : "Net";

  const recent = transactions.slice(0, 9);
  const unreviewedList = transactions.filter((t) => !t.reviewed);
  const unreviewed = unreviewedList.length;
  const unreviewedTotal = unreviewedList.reduce((s, t) => s + Math.abs(t.amount), 0);

  const loading = la || lt;

  if (loading) {
    return <GaugeLoader />;
  }

  return (
    <main className="p-4 space-y-5">
      {/* Hero with month navigation */}
      <div className="rounded-[16px] p-6 bg-hero-gradient text-white text-center">
        <p className="text-sm font-medium opacity-80">{heroLabel}</p>
        <p className="font-figure text-5xl font-bold mt-1">{fmt0(heroValue)}</p>
        <div className="flex items-center justify-center gap-3 mt-2">
          <button onClick={() => setMonth(addMonth(month, -1))} className="opacity-80 active:opacity-50">
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_left</span>
          </button>
          <span className="text-sm opacity-90 min-w-[110px] text-center">{monthLabel(month)}</span>
          <button
            onClick={() => canGoForward && setMonth(addMonth(month, 1))}
            disabled={!canGoForward}
            className="active:opacity-50"
            style={{ opacity: canGoForward ? 0.8 : 0.3 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>chevron_right</span>
          </button>
        </div>
      </div>

      {/* Two-column dashboard on desktop; single stack on mobile */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start space-y-5 lg:space-y-0">
        <div className="space-y-5">
      {/* Review-queue card (only when there's something to review) */}
      {unreviewed > 0 && (
        <button
          onClick={() => setShowReview(true)}
          className="w-full rounded-[16px] border p-4 flex items-center justify-between text-left"
          style={{ background: "var(--color-surface)", borderColor: "var(--color-primary)" }}
        >
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              {unreviewed} to review
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
              {fmt0(unreviewedTotal)} across new transactions
            </p>
          </div>
          <span
            className="inline-flex items-center gap-1 text-sm font-semibold px-3 py-1.5 rounded-full text-white"
            style={{ background: "var(--color-primary)" }}
          >
            Review
            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
          </span>
        </button>
      )}

      {/* Empty state: no accounts yet */}
      {accounts.length === 0 && (
        <Card className="p-5 text-center space-y-3">
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Add your first account to start tracking balances and spending.
          </p>
          <Button onClick={() => setSheet("account")}>+ Add account</Button>
        </Card>
      )}

      {/* Monthly summary — Income & Spent open the matching transactions */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <MiniCard
            label="Income"
            value={fmt0(roll.income)}
            onClick={() => router.push(`/activity?type=income&month=${month}`)}
          />
          <MiniCard
            label="Spent"
            value={fmt0(roll.spend)}
            onClick={() => router.push(`/activity?type=spending&month=${month}`)}
          />
          <MiniCard
            label="Leftover"
            value={fmt0(income - roll.spend)}
            accent={income - roll.spend >= 0 ? "var(--color-positive)" : "var(--color-danger)"}
          />
        </div>
      )}

      {/* Plan vs actual */}
      {accounts.length > 0 && budget && (
        <Card className="p-4 space-y-3">
          <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Spending by bucket
          </p>
          {(Object.keys(BUCKETS) as BucketType[]).map((b) => {
            const planPct =
              b === "needs" ? budget.plan_needs : b === "wants" ? budget.plan_wants : budget.plan_savings;
            const actual = roll.byBucket[b];
            const actualPct = roll.spend > 0 ? Math.round((actual / roll.spend) * 100) : 0;
            return (
              <div key={b} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: BUCKETS[b].color }} />
                  <span style={{ color: "var(--color-text)" }}>{BUCKETS[b].label}</span>
                </span>
                <span style={{ color: "var(--color-muted)" }}>
                  {fmt0(actual)}{" "}
                  <span style={{ color: "var(--color-text)", fontWeight: 600 }}>{actualPct}%</span>
                  <span style={{ color: "var(--color-faint)" }}> / plan {planPct}%</span>
                </span>
              </div>
            );
          })}
        </Card>
      )}

      {/* Recent transactions */}
      {recent.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Recent
            </h2>
            {unreviewed > 0 && (
              <span className="text-xs" style={{ color: "var(--color-muted)" }}>
                {unreviewed} to review
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {recent.map((t) => (
              <TxnTile
                key={t.id}
                txn={t}
                categoryById={categoryById}
                onClick={() => setEditTxn(t)}
              />
            ))}
          </div>
        </section>
      )}

        </div>{/* left column */}

        <div className="space-y-5">
      {/* Accounts */}
      {accounts.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Accounts
            </h2>
            <button
              className="text-xs font-semibold"
              style={{ color: "var(--color-primary)" }}
              onClick={() => setSheet("account")}
            >
              + Add
            </button>
          </div>
          <Card className="divide-y" style={{ borderColor: "var(--color-hairline)" }}>
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                    {a.name}
                  </p>
                  <p className="text-xs capitalize" style={{ color: "var(--color-faint)" }}>
                    {a.type}{a.last4 ? ` ••${a.last4}` : ""}
                  </p>
                </div>
                <p
                  className="font-figure text-sm font-semibold"
                  style={{
                    color:
                      (balances[a.id] ?? 0) < 0
                        ? "var(--color-danger)"
                        : "var(--color-text)",
                  }}
                >
                  {fmt(balances[a.id] ?? 0)}
                </p>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                Net cash
              </p>
              <p
                className="font-figure text-sm font-bold"
                style={{ color: netCash < 0 ? "var(--color-danger)" : "var(--color-positive)" }}
              >
                {fmt(netCash)}
              </p>
            </div>
          </Card>
        </section>
      )}

      {/* Quick add */}
      {accounts.length > 0 && (
        <Button fullWidth variant="secondary" onClick={() => setSheet("txn")}>
          + New transaction
        </Button>
      )}
        </div>{/* right column */}
      </div>{/* dashboard grid */}

      {sheet === "account" && <AccountEditor onClose={() => setSheet(null)} />}
      {sheet === "txn" && <NewTransaction onClose={() => setSheet(null)} />}
      {showReview && <ReviewFlow onClose={() => setShowReview(false)} />}
      {editTxn && (
        <TransactionEditor txn={editTxn} onClose={() => setEditTxn(null)} />
      )}
    </main>
  );
}

function MiniCard({
  label,
  value,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  accent?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`p-3 rounded-[16px] border text-left w-full ${onClick ? "active:opacity-70 transition-opacity" : ""}`}
      style={{ background: "var(--color-surface)", borderColor: "var(--color-hairline)" }}
    >
      <p className="text-[11px] flex items-center gap-0.5" style={{ color: "var(--color-faint)" }}>
        {label}
        {onClick && (
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>chevron_right</span>
        )}
      </p>
      <p
        className="font-figure text-base font-bold mt-0.5"
        style={{ color: accent ?? "var(--color-text)" }}
      >
        {value}
      </p>
    </Tag>
  );
}
