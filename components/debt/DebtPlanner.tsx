"use client";

import { useMemo, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { projectDebt, type ProjDebt } from "@/lib/debtProjection";
import type { DebtStrategy } from "@/lib/debt";
import type { Account, Settings } from "@/lib/types";
import { fmt0 } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { useSetAccountMinPayment, useUpdateSettings } from "@/hooks/useSupabaseData";
import { minPayment as estMinPayment } from "@/lib/debt";

// Recharts is heavy — load the charts only after the rest of the tab paints.
const DebtCharts = dynamic(() => import("@/components/debt/DebtCharts"), {
  ssr: false,
  loading: () => (
    <Card className="p-3 flex items-center justify-center" style={{ height: 240 }}>
      <span className="text-xs" style={{ color: "var(--color-faint)" }}>Loading charts…</span>
    </Card>
  ),
});

const DEBT_COLORS = ["#EF4444", "#3B82F6", "#EAB308", "#8B5CF6", "#14B8A6", "#F97316", "#EC4899"];

function monthsLabel(m: number): string {
  const y = Math.floor(m / 12);
  const r = m % 12;
  return y === 0 ? `${r}m` : r === 0 ? `${y}y` : `${y}y ${r}m`;
}

interface Props {
  liabilityAccounts: Account[]; // credit/loan with balance owed
  debtBalances: Record<string, number>; // account_id → owed (positive)
  strategy: DebtStrategy;
  avgNet3: number; // 3-month average net available (default surplus)
  startChecking: number;
  startSavings: number;
  settings: Settings | null | undefined;
}

export function DebtPlanner({
  liabilityAccounts,
  debtBalances,
  strategy,
  avgNet3,
  startChecking,
  startSavings,
  settings,
}: Props) {
  const setMin = useSetAccountMinPayment();
  const updateSettings = useUpdateSettings();

  // planner inputs (hydrated from settings)
  const [surplus, setSurplus] = useState("");
  const [extra, setExtra] = useState("");
  const [invBal, setInvBal] = useState("0");
  const [invRet, setInvRet] = useState("0");
  const [savingsPct, setSavingsPct] = useState(20);
  const [investPct, setInvestPct] = useState(0);
  useEffect(() => {
    if (!settings) return;
    setSurplus(settings.debt_surplus != null ? String(settings.debt_surplus) : String(Math.round(avgNet3)));
    setExtra(settings.debt_extra ? String(settings.debt_extra) : "");
    setInvBal(String(settings.investments_balance ?? 0));
    setInvRet(String(settings.investments_return ?? 0));
    setSavingsPct(settings.surplus_savings_pct ?? 20);
    setInvestPct(settings.surplus_investments_pct ?? 0);
  }, [settings, avgNet3]);
  const extraDebtPct = Math.max(0, 100 - savingsPct - investPct);

  const monthlySurplus = (parseFloat(surplus) || 0) + (parseFloat(extra) || 0);

  const debts: ProjDebt[] = useMemo(
    () =>
      liabilityAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        balance: debtBalances[a.id] ?? 0,
        apr: a.apr,
        minPayment: a.min_payment ?? estMinPayment(debtBalances[a.id] ?? 0),
      })),
    [liabilityAccounts, debtBalances],
  );

  const projection = useMemo(
    () =>
      projectDebt({
        debts,
        strategy,
        monthlySurplus,
        savingsPct,
        investmentsPct: investPct,
        startChecking,
        startSavings,
        startInvestments: parseFloat(invBal) || 0,
        investReturnPct: parseFloat(invRet) || 0,
      }),
    [debts, strategy, monthlySurplus, savingsPct, investPct, startChecking, startSavings, invBal, invRet],
  );

  const debtChartData = useMemo(
    () =>
      projection.points.map((p) => {
        const row: Record<string, number> = { month: p.month };
        for (const d of debts) row[d.name] = p.debt[d.id] ?? 0;
        return row;
      }),
    [projection, debts],
  );

  const netWorthData = useMemo(
    () =>
      projection.points.map((p) => ({
        month: p.month,
        Checking: p.checking,
        Savings: p.savings,
        Investments: p.investments,
        "Total debt": p.totalDebt,
        "Net worth": p.netWorth,
      })),
    [projection],
  );

  const persistSplit = (s: number, i: number) =>
    updateSettings.mutate({ surplus_savings_pct: s, surplus_investments_pct: i });

  return (
    <div className="space-y-5">
      {/* Surplus allocation + payoff timeline, side by side on desktop */}
      <div className="lg:grid lg:grid-cols-2 lg:gap-5 lg:items-start space-y-5 lg:space-y-0">
      {/* Surplus + allocation */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Surplus allocation</h2>
        <Card className="p-4 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <Input
                label="Monthly surplus"
                inputMode="decimal"
                value={surplus}
                onChange={(e) => setSurplus(e.target.value)}
                onBlur={() => updateSettings.mutate({ debt_surplus: parseFloat(surplus) || 0 })}
              />
            </div>
            <div className="flex-1">
              <Input
                label="Extra payment / mo"
                inputMode="decimal"
                placeholder="0"
                value={extra}
                onChange={(e) => setExtra(e.target.value)}
                onBlur={() => updateSettings.mutate({ debt_extra: parseFloat(extra) || 0 })}
              />
            </div>
          </div>
          <p className="text-xs" style={{ color: "var(--color-faint)" }}>
            Allocating {fmt0(monthlySurplus)}/mo — your surplus (defaults to the
            3-month average net above) plus any extra payment.
          </p>

          <SplitSlider
            label="To savings"
            value={savingsPct}
            color="#16A34A"
            onChange={(v) => setSavingsPct(Math.min(v, 100 - investPct))}
            onCommit={() => persistSplit(savingsPct, investPct)}
          />
          <SplitSlider
            label="To investments"
            value={investPct}
            color="#8B5CF6"
            onChange={(v) => setInvestPct(Math.min(v, 100 - savingsPct))}
            onCommit={() => persistSplit(savingsPct, investPct)}
          />
          <div className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--color-text)" }}>To extra debt</span>
            <span className="text-sm font-figure font-bold" style={{ color: "var(--color-text)" }}>{extraDebtPct}%</span>
          </div>
          <div className="flex h-7 rounded-lg overflow-hidden text-[11px] font-semibold text-white">
            {savingsPct > 0 && <div className="flex items-center justify-center" style={{ width: `${savingsPct}%`, background: "#16A34A" }}>{savingsPct}%</div>}
            {investPct > 0 && <div className="flex items-center justify-center" style={{ width: `${investPct}%`, background: "#8B5CF6" }}>{investPct}%</div>}
            {extraDebtPct > 0 && <div className="flex items-center justify-center" style={{ width: `${extraDebtPct}%`, background: "#EF4444" }}>{extraDebtPct}%</div>}
          </div>
          <p className="text-xs leading-relaxed" style={{ color: "var(--color-faint)" }}>
            Freed-up minimums roll into the next-highest-APR debt. Your savings &amp;
            investing percentages keep flowing, and once debt-free the freed money
            redirects to savings.
          </p>
        </Card>
      </section>

      {/* Payoff timeline */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Payoff timeline
          </h2>
          <span className="text-xs" style={{ color: "var(--color-faint)" }}>
            debt-free in {monthsLabel(projection.debtFreeMonth)}
          </span>
        </div>
        <Card className="divide-y" style={{ borderColor: "var(--color-hairline)" }}>
          {projection.order.map((d, i) => (
            <div key={d.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <span
                  className="flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold"
                  style={{ background: `${DEBT_COLORS[i % DEBT_COLORS.length]}22`, color: DEBT_COLORS[i % DEBT_COLORS.length] }}
                >
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>{d.name}</p>
                  <p className="text-xs" style={{ color: "var(--color-faint)" }}>
                    {d.apr}% APR · {fmt0(d.balance)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-figure" style={{ color: "var(--color-text)" }}>Month {d.monthsToClear}</p>
                <p className="text-xs" style={{ color: "var(--color-muted)" }}>{monthsLabel(d.monthsToClear)}</p>
              </div>
            </div>
          ))}
        </Card>
      </section>
      </div>{/* surplus + timeline grid */}

      {/* Projection charts (Recharts, lazy-loaded) */}
      <DebtCharts
        debtChartData={debtChartData}
        netWorthData={netWorthData}
        debts={debts.map((d) => ({ id: d.id, name: d.name }))}
        colors={DEBT_COLORS}
      />

      {/* Debts — editable minimum payment */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Debts</h2>
        <Card className="divide-y" style={{ borderColor: "var(--color-hairline)" }}>
          {liabilityAccounts.map((a) => (
            <MinPaymentRow
              key={a.id}
              account={a}
              owed={debtBalances[a.id] ?? 0}
              onSave={(v) => setMin.mutate({ id: a.id, min_payment: v })}
            />
          ))}
        </Card>
        <p className="text-xs" style={{ color: "var(--color-faint)" }}>
          Edit balances &amp; APR in account settings. Blank min payment uses a 2% estimate.
        </p>
      </section>
    </div>
  );
}

function MinPaymentRow({ account, owed, onSave }: { account: Account; owed: number; onSave: (v: number | null) => void }) {
  const [val, setVal] = useState(account.min_payment != null ? String(account.min_payment) : "");
  useEffect(() => {
    setVal(account.min_payment != null ? String(account.min_payment) : "");
  }, [account.min_payment]);
  return (
    <div className="flex items-center justify-between px-4 py-3 gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--color-text)" }}>{account.name}</p>
        <p className="text-xs" style={{ color: "var(--color-faint)" }}>{account.apr}% APR · {fmt0(owed)}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-xs" style={{ color: "var(--color-faint)" }}>min $</span>
        <input
          inputMode="decimal"
          placeholder={fmt0(estMinPayment(owed)).replace("$", "")}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={() => onSave(val === "" ? null : parseFloat(val) || null)}
          className="w-20 text-right px-2 py-1.5 rounded-lg text-sm font-figure outline-none border"
          style={{ background: "var(--color-elevated)", color: "var(--color-text)", borderColor: "var(--color-hairline)" }}
        />
      </div>
    </div>
  );
}

function SplitSlider({
  label,
  value,
  color,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  color: string;
  onChange: (v: number) => void;
  onCommit: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm w-28" style={{ color: "var(--color-text)" }}>{label}</span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="flex-1"
        style={{ accentColor: color }}
      />
      <span className="text-sm font-figure font-bold w-10 text-right" style={{ color: "var(--color-text)" }}>{value}%</span>
    </div>
  );
}
