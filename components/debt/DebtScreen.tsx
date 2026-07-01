"use client";

import { useMemo, useState, useEffect } from "react";
import {
  useAccounts,
  useTransactions,
  useBudget,
  useSettings,
  useUpdateSettings,
  useAccountBalances,
} from "@/hooks/useSupabaseData";
import { rollup } from "@/lib/aggregations";
import { type DebtStrategy } from "@/lib/debt";
import { LIABILITY_TYPES } from "@/lib/buckets";
import { fmt0, currentMonthKey } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { DebtPlanner } from "@/components/debt/DebtPlanner";

function addMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function DebtScreen() {
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const { data: budget } = useBudget();
  const { data: settings } = useSettings();
  const { data: balances = {} } = useAccountBalances();
  const updateSettings = useUpdateSettings();

  const liabilityAccounts = useMemo(
    () => accounts.filter((a) => LIABILITY_TYPES.includes(a.type) && (balances[a.id] ?? 0) < 0),
    [accounts, balances],
  );
  const debtBalances = useMemo(
    () => Object.fromEntries(liabilityAccounts.map((a) => [a.id, Math.abs(balances[a.id] ?? 0)])),
    [liabilityAccounts, balances],
  );
  const totalDebt = liabilityAccounts.reduce((s, a) => s + Math.abs(balances[a.id] ?? 0), 0);

  const startChecking = useMemo(
    () =>
      accounts
        .filter((a) => a.type === "checking" || a.type === "cash")
        .reduce((s, a) => s + Math.max(0, balances[a.id] ?? 0), 0),
    [accounts, balances],
  );
  const startSavings = useMemo(
    () =>
      accounts
        .filter((a) => a.type === "savings")
        .reduce((s, a) => s + Math.max(0, balances[a.id] ?? 0), 0),
    [accounts, balances],
  );

  // Average net available per month over the last 3 months (view only).
  const avgNet3 = useMemo(() => {
    const income = budget?.income ?? 0;
    const now = currentMonthKey();
    const nets = [0, 1, 2].map((i) => income - rollup(transactions, addMonth(now, -i)).spend);
    return nets.reduce((a, b) => a + b, 0) / nets.length;
  }, [transactions, budget]);

  const [strategy, setStrategy] = useState<DebtStrategy>("avalanche");
  useEffect(() => {
    if (settings) setStrategy(settings.debt_strategy);
  }, [settings]);

  return (
    <main className="p-4 space-y-5">
      <h1 className="font-figure text-xl font-bold" style={{ color: "var(--color-text)" }}>
        Debt
      </h1>

      {liabilityAccounts.length === 0 ? (
        <Card className="p-5 text-center">
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            No debts to plan. Add a credit card or loan account (with a balance
            owed) and it will show up here.
          </p>
        </Card>
      ) : (
        <>
          {/* totals */}
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-4">
              <p className="text-xs" style={{ color: "var(--color-faint)" }}>Total debt</p>
              <p className="font-figure text-2xl font-bold mt-1" style={{ color: "var(--color-danger)" }}>
                {fmt0(totalDebt)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs" style={{ color: "var(--color-faint)" }}>Avg net / mo · 3 mo</p>
              <p
                className="font-figure text-2xl font-bold mt-1"
                style={{ color: avgNet3 >= 0 ? "var(--color-positive)" : "var(--color-danger)" }}
              >
                {fmt0(avgNet3)}
              </p>
            </Card>
          </div>

          {/* strategy */}
          <div className="flex gap-2">
            <Chip
              active={strategy === "avalanche"}
              onClick={() => { setStrategy("avalanche"); updateSettings.mutate({ debt_strategy: "avalanche" }); }}
            >
              Avalanche (highest APR)
            </Chip>
            <Chip
              active={strategy === "snowball"}
              onClick={() => { setStrategy("snowball"); updateSettings.mutate({ debt_strategy: "snowball" }); }}
            >
              Snowball (smallest first)
            </Chip>
          </div>

          <DebtPlanner
            liabilityAccounts={liabilityAccounts}
            debtBalances={debtBalances}
            strategy={strategy}
            avgNet3={avgNet3}
            startChecking={startChecking}
            startSavings={startSavings}
            settings={settings}
          />
        </>
      )}
    </main>
  );
}
