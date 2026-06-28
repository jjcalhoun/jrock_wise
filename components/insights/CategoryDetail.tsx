"use client";

import { useMemo } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { rollup, categoryAverages, monthKey } from "@/lib/aggregations";
import { fmt, fmt0, shortDate, monthLabel } from "@/lib/format";
import type { Category, Transaction } from "@/lib/types";

interface Props {
  category: Category;
  transactions: Transaction[];
  month: string; // "YYYY-MM"
  monthlyTarget: number;
  onClose: () => void;
}

export function CategoryDetail({
  category,
  transactions,
  month,
  monthlyTarget,
  onClose,
}: Props) {
  // 7-month history ending at the selected month
  const history = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const out: { key: string; label: string; spend: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(y, m - 1 - i, 1);
      const mk = monthKey(d);
      const { byCat } = rollup(transactions, mk);
      out.push({
        key: mk,
        label: `${d.getMonth() + 1}`,
        spend: byCat[category.id] ?? 0,
      });
    }
    return out;
  }, [transactions, month, category.id]);

  const maxSpend = Math.max(...history.map((h) => h.spend), monthlyTarget, 1);

  const { avg3, avg6 } = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    return categoryAverages(transactions, category.id, new Date(y, m - 1, 15));
  }, [transactions, month, category.id]);

  const monthTxns = useMemo(
    () =>
      transactions.filter(
        (t) =>
          monthKey(t.date) === month &&
          (t.splits ?? []).some((s) => s.category_id === category.id),
      ),
    [transactions, month, category.id],
  );

  return (
    <Sheet title={category.name} onClose={onClose}>
      <div className="px-5 py-4 space-y-5">
        {/* history bars */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
            Last 7 months
          </p>
          <div className="flex items-end justify-between gap-1 h-28">
            {history.map((h) => (
              <div key={h.key} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex items-end h-full">
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${Math.max(2, (h.spend / maxSpend) * 100)}%`,
                      background:
                        h.key === month ? category.color : `${category.color}66`,
                    }}
                  />
                </div>
                <span className="text-[9px]" style={{ color: "var(--color-faint)" }}>
                  {h.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* averages + budget */}
        <div className="grid grid-cols-3 gap-3">
          <Stat label="3-mo avg" value={fmt0(avg3)} />
          <Stat label="6-mo avg" value={fmt0(avg6)} />
          <Stat label="Budget" value={fmt0(monthlyTarget)} />
        </div>

        {/* this month's transactions */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
            {monthLabel(month)} transactions
          </p>
          {monthTxns.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-faint)" }}>
              None this month.
            </p>
          ) : (
            <div className="space-y-1">
              {monthTxns.map((t) => {
                const split = (t.splits ?? []).find(
                  (s) => s.category_id === category.id,
                );
                return (
                  <div
                    key={t.id}
                    className="flex items-center justify-between py-1.5 text-sm"
                  >
                    <span style={{ color: "var(--color-text)" }}>
                      {t.merchant ?? "Transaction"}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-figure" style={{ color: "var(--color-text)" }}>
                        {fmt(-(split?.amount ?? 0))}
                      </span>
                      <span className="text-xs" style={{ color: "var(--color-faint)" }}>
                        {shortDate(t.date)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-[12px] border p-3 text-center"
      style={{ background: "var(--color-surface)", borderColor: "var(--color-hairline)" }}
    >
      <p className="text-[10px]" style={{ color: "var(--color-faint)" }}>
        {label}
      </p>
      <p className="font-figure text-sm font-bold mt-0.5" style={{ color: "var(--color-text)" }}>
        {value}
      </p>
    </div>
  );
}
