"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { fmt } from "@/lib/format";
import { Card } from "@/components/ui/Card";

/* The two Recharts projection charts, split into their own module so Recharts
   (~a large dependency) is lazy-loaded on the Debt tab only after the rest of
   the page has painted. */

const yrTick = (m: number) => (m === 0 ? "Now" : m % 12 === 0 ? `Yr ${m / 12}` : "");
const kAxis = (v: number) => `$${Math.round(v / 1000)}k`;

interface Props {
  debtChartData: Record<string, number>[];
  netWorthData: Record<string, number>[];
  debts: { id: string; name: string }[];
  colors: string[];
}

export default function DebtCharts({ debtChartData, netWorthData, debts, colors }: Props) {
  return (
    <>
      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Debt balances over time
        </h2>
        <Card className="p-3">
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={debtChartData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="2 2" />
              <XAxis dataKey="month" tickFormatter={yrTick} interval={0} tick={{ fontSize: 10, fill: "var(--color-faint)" }} />
              <YAxis tickFormatter={kAxis} width={44} tick={{ fontSize: 10, fill: "var(--color-faint)" }} />
              <Tooltip content={<ChartTooltip />} />
              {debts.map((d, i) => (
                <Line key={d.id} type="monotone" dataKey={d.name} stroke={colors[i % colors.length]} strokeWidth={2} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 px-1">
            {debts.map((d, i) => (
              <LegendSwatch key={d.id} color={colors[i % colors.length]} label={d.name} />
            ))}
          </div>
        </Card>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Accounts vs debt &amp; net worth
        </h2>
        <Card className="p-3">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={netWorthData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid stroke="var(--color-hairline)" strokeDasharray="2 2" />
              <XAxis dataKey="month" tickFormatter={yrTick} interval={0} tick={{ fontSize: 10, fill: "var(--color-faint)" }} />
              <YAxis tickFormatter={kAxis} width={44} tick={{ fontSize: 10, fill: "var(--color-faint)" }} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="Checking" stroke="#9CA3AF" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Savings" stroke="#16A34A" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Investments" stroke="#8B5CF6" strokeWidth={2} strokeDasharray="4 3" dot={false} />
              <Line type="monotone" dataKey="Total debt" stroke="#EF4444" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Net worth" stroke="#3B82F6" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 px-1">
            <LegendSwatch color="#9CA3AF" label="Checking" />
            <LegendSwatch color="#16A34A" label="Savings" />
            <LegendSwatch color="#8B5CF6" label="Investments" />
            <LegendSwatch color="#EF4444" label="Total debt" />
            <LegendSwatch color="#3B82F6" label="Net worth" />
          </div>
        </Card>
      </section>
    </>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--color-muted)" }}>
      <span className="inline-block w-3 h-1 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

interface TooltipEntry { name: string; value: number; color: string }
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: number }) {
  if (!active || !payload?.length) return null;
  const m = Number(label);
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "#111418", border: "1px solid #272D38" }}>
      <p className="mb-1 font-semibold" style={{ color: "#fff" }}>
        Year {Math.floor(m / 12)}, month {m % 12} (mo {m})
      </p>
      {payload.map((e) => (
        <p key={e.name} className="flex items-center justify-between gap-4" style={{ color: e.color }}>
          <span>{e.name}</span>
          <span className="font-figure">{fmt(e.value)}</span>
        </p>
      ))}
    </div>
  );
}
