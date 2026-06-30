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
import { planPayoff, type DebtInput, type DebtStrategy } from "@/lib/debt";
import { LIABILITY_TYPES } from "@/lib/buckets";
import { fmt, fmt0, currentMonthKey } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";

function monthsLabel(m: number): string {
  if (m <= 0) return "—";
  const y = Math.floor(m / 12);
  const r = m % 12;
  if (y === 0) return `${r} mo`;
  if (r === 0) return `${y} yr`;
  return `${y} yr ${r} mo`;
}

export function DebtScreen() {
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const { data: budget } = useBudget();
  const { data: settings } = useSettings();
  const { data: balances = {} } = useAccountBalances();
  const updateSettings = useUpdateSettings();

  const debts: DebtInput[] = useMemo(
    () =>
      accounts
        .filter((a) => LIABILITY_TYPES.includes(a.type) && (balances[a.id] ?? 0) < 0)
        .map((a) => ({
          id: a.id,
          name: a.name,
          balance: Math.abs(balances[a.id] ?? 0),
          apr: a.apr,
        })),
    [accounts, balances],
  );

  const totalDebt = debts.reduce((s, d) => s + d.balance, 0);

  const month = currentMonthKey();
  const roll = useMemo(() => rollup(transactions, month), [transactions, month]);
  const available = Math.max(0, (budget?.income ?? 0) - roll.spend);

  const [strategy, setStrategy] = useState<DebtStrategy>("avalanche");
  const [extra, setExtra] = useState<string>("");

  // hydrate controls from saved settings once loaded
  useEffect(() => {
    if (settings) {
      setStrategy(settings.debt_strategy);
      setExtra(settings.debt_extra ? String(settings.debt_extra) : "");
    }
  }, [settings]);

  const extraNum = extra === "" ? available : parseFloat(extra) || 0;
  const plan = useMemo(
    () => planPayoff(debts, extraNum, strategy),
    [debts, extraNum, strategy],
  );

  function persist(next: { strategy?: DebtStrategy; extra?: number }) {
    updateSettings.mutate({
      debt_strategy: next.strategy ?? strategy,
      debt_extra: next.extra ?? extraNum,
    });
  }

  return (
    <main className="p-4 space-y-5">
      <h1 className="font-figure text-xl font-bold" style={{ color: "var(--color-text)" }}>
        Debt
      </h1>

      {debts.length === 0 ? (
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
              <p className="text-xs" style={{ color: "var(--color-faint)" }}>Available / mo</p>
              <p className="font-figure text-2xl font-bold mt-1" style={{ color: "var(--color-positive)" }}>
                {fmt0(available)}
              </p>
            </Card>
          </div>

          {/* strategy */}
          <div className="flex gap-2">
            <Chip
              active={strategy === "avalanche"}
              onClick={() => { setStrategy("avalanche"); persist({ strategy: "avalanche" }); }}
            >
              Avalanche (highest APR)
            </Chip>
            <Chip
              active={strategy === "snowball"}
              onClick={() => { setStrategy("snowball"); persist({ strategy: "snowball" }); }}
            >
              Snowball (smallest first)
            </Chip>
          </div>

          {/* extra payment */}
          <Card className="p-4 space-y-2">
            <Input
              label="Extra payment / month"
              inputMode="decimal"
              placeholder={fmt0(available)}
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              onBlur={() => persist({ extra: extraNum })}
            />
            <p className="text-xs" style={{ color: "var(--color-faint)" }}>
              Defaults to your available leftover. Debt-free in about{" "}
              <span style={{ color: "var(--color-text)" }}>{monthsLabel(plan.totalMonths)}</span>,
              paying {fmt0(plan.totalInterest)} interest.
            </p>
          </Card>

          {/* payoff order */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Payoff order
            </h2>
            {plan.order.map((d, i) => (
              <Card key={d.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
                    style={{ background: "var(--color-chip-bg)", color: "var(--color-text)" }}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                      {d.name}
                    </p>
                    <p className="text-xs" style={{ color: "var(--color-faint)" }}>
                      {d.apr}% APR
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-figure text-sm font-semibold" style={{ color: "var(--color-text)" }}>
                    {fmt(d.balance)}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                    {monthsLabel(d.monthsToClear)}
                  </p>
                </div>
              </Card>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
