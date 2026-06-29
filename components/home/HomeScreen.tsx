"use client";

import { useMemo, useState } from "react";
import {
  useAccounts,
  useCategories,
  useTransactions,
  useBudget,
} from "@/hooks/useSupabaseData";
import { rollup, allBalances } from "@/lib/aggregations";
import { fmt0, fmt, currentMonthKey, monthLabel } from "@/lib/format";
import { BUCKETS } from "@/lib/buckets";
import { TxnTile } from "@/components/transactions/TxnTile";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AccountEditor } from "@/components/settings/AccountEditor";
import { NewTransaction } from "@/components/transactions/NewTransaction";
import { TransactionEditor } from "@/components/transactions/TransactionEditor";
import type { BucketType, Transaction } from "@/lib/types";

export function HomeScreen() {
  const { data: accounts = [], isLoading: la } = useAccounts();
  const { data: categories = [] } = useCategories();
  const { data: transactions = [], isLoading: lt } = useTransactions();
  const { data: budget } = useBudget();
  const [sheet, setSheet] = useState<"account" | "txn" | null>(null);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);

  const month = currentMonthKey();
  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const balances = useMemo(
    () => allBalances(accounts, transactions),
    [accounts, transactions],
  );
  const netCash = accounts.reduce((s, a) => s + (balances[a.id] ?? 0), 0);

  const roll = useMemo(() => rollup(transactions, month), [transactions, month]);
  const income = budget?.income ?? 0;
  const safeToSpend = Math.max(0, income - roll.spend);

  const recent = transactions.slice(0, 6);
  const unreviewed = transactions.filter((t) => !t.reviewed).length;

  const loading = la || lt;

  if (loading) {
    return (
      <div className="p-4 space-y-4 animate-pulse">
        <div className="h-32 rounded-[16px]" style={{ background: "var(--color-surface)" }} />
        <div className="h-24 rounded-[16px]" style={{ background: "var(--color-surface)" }} />
      </div>
    );
  }

  return (
    <main className="p-4 space-y-5">
      {/* Hero */}
      <div className="rounded-[16px] p-6 bg-hero-gradient text-white">
        <p className="text-sm font-medium opacity-80">Safe to spend</p>
        <p className="font-figure text-5xl font-bold mt-1">{fmt0(safeToSpend)}</p>
        <p className="text-sm opacity-70 mt-1">{monthLabel(month)}</p>
      </div>

      {/* Empty state: no accounts yet */}
      {accounts.length === 0 && (
        <Card className="p-5 text-center space-y-3">
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Add your first account to start tracking balances and spending.
          </p>
          <Button onClick={() => setSheet("account")}>+ Add account</Button>
        </Card>
      )}

      {/* Monthly summary */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <MiniCard label="Income" value={fmt0(roll.income)} />
          <MiniCard label="Spent" value={fmt0(roll.spend)} />
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
            return (
              <div key={b} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: BUCKETS[b].color }} />
                  <span style={{ color: "var(--color-text)" }}>{BUCKETS[b].label}</span>
                </span>
                <span style={{ color: "var(--color-muted)" }}>
                  {fmt(actual)} <span style={{ color: "var(--color-faint)" }}>· plan {planPct}%</span>
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

      {sheet === "account" && <AccountEditor onClose={() => setSheet(null)} />}
      {sheet === "txn" && <NewTransaction onClose={() => setSheet(null)} />}
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
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <Card className="p-3">
      <p className="text-[11px]" style={{ color: "var(--color-faint)" }}>
        {label}
      </p>
      <p
        className="font-figure text-base font-bold mt-0.5"
        style={{ color: accent ?? "var(--color-text)" }}
      >
        {value}
      </p>
    </Card>
  );
}
