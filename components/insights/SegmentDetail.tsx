"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { fmt, shortDate, monthLabel } from "@/lib/format";
import { TransactionEditor } from "@/components/transactions/TransactionEditor";
import type { Transaction } from "@/lib/types";

export interface DetailSegment {
  label: string;
  color: string;
  icon: string;
  value: number;
}

interface Props {
  segment: DetailSegment;
  transactions: Transaction[]; // the txns behind this segment, this month
  month: string; // "YYYY-MM"
  accountNameById: Record<string, string>;
  breakdown?: { label: string; value: number }[]; // optional sub-totals (e.g. per loan)
  onClose: () => void;
}

/* Drill-down for a budget slice: its transactions, each opening the editor. */
export function SegmentDetail({ segment, transactions, month, accountNameById, breakdown, onClose }: Props) {
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const rows = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <Sheet onClose={onClose}>
      <div className="px-5 pb-4 space-y-4">
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-9 h-9 rounded-xl"
            style={{ background: `${segment.color}22` }}
          >
            <span className="material-symbols-outlined" style={{ color: segment.color }}>
              {segment.icon}
            </span>
          </span>
          <div>
            <p className="font-figure text-2xl font-bold" style={{ color: "var(--color-text)" }}>
              {fmt(segment.value)}
            </p>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              {segment.label} · {monthLabel(month)}
            </p>
          </div>
        </div>

        {breakdown && breakdown.length > 0 && (
          <div className="rounded-[12px] p-3 space-y-1" style={{ background: "var(--color-surface)" }}>
            {breakdown.map((b) => (
              <div key={b.label} className="flex justify-between text-sm">
                <span className="truncate pr-2" style={{ color: "var(--color-muted)" }}>{b.label}</span>
                <span className="font-figure shrink-0" style={{ color: "var(--color-text)" }}>{fmt(b.value)}</span>
              </div>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-faint)" }}>None this month.</p>
        ) : (
          <div className="space-y-1">
            {rows.map((t) => {
              // Show the transfer in the natural direction (money's destination).
              const inflow = t.amount > 0;
              const from = accountNameById[inflow ? t.transfer_account_id ?? "" : t.account_id];
              const to = accountNameById[inflow ? t.account_id : t.transfer_account_id ?? ""];
              const label =
                t.type === "transfer"
                  ? from && to
                    ? `${from} → ${to}`
                    : t.merchant ?? "Transfer"
                  : t.merchant ?? "Transaction";
              return (
                <button
                  key={t.id}
                  onClick={() => setEditTxn(t)}
                  className="w-full flex items-center justify-between py-1.5 text-sm text-left active:opacity-70"
                >
                  <span className="truncate pr-2" style={{ color: "var(--color-text)" }}>{label}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="font-figure" style={{ color: "var(--color-text)" }}>{fmt(Math.abs(t.amount))}</span>
                    <span className="text-xs" style={{ color: "var(--color-faint)" }}>{shortDate(t.date)}</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-faint)" }}>chevron_right</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {editTxn && <TransactionEditor txn={editTxn} onClose={() => setEditTxn(null)} />}
    </Sheet>
  );
}
