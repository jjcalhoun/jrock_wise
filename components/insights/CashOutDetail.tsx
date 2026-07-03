"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { fmt, shortDate, monthLabel } from "@/lib/format";
import { TransactionEditor } from "@/components/transactions/TransactionEditor";
import type { CashOutSegment } from "@/lib/aggregations";
import type { Transaction } from "@/lib/types";

interface Props {
  segment: CashOutSegment;
  transactions: Transaction[]; // the txns that make up this segment, this month
  month: string; // "YYYY-MM"
  accountNameById: Record<string, string>;
  onClose: () => void;
}

/* Drill-down for one Cash-out slice: the transactions behind it, each opening
   the editor. Mirrors CategoryDetail's transaction list. */
export function CashOutDetail({ segment, transactions, month, accountNameById, onClose }: Props) {
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);
  const rows = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return (
    <Sheet onClose={onClose}>
      <div className="px-5 pb-4 space-y-4">
        {/* title */}
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

        {/* transactions */}
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--color-faint)" }}>
            None this month.
          </p>
        ) : (
          <div className="space-y-1">
            {rows.map((t) => {
              // Cash-out transfers are the outflow leg, so read source → dest.
              const from = accountNameById[t.account_id];
              const to = accountNameById[t.transfer_account_id ?? ""];
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
                  <span className="truncate pr-2" style={{ color: "var(--color-text)" }}>
                    {label}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="font-figure" style={{ color: "var(--color-text)" }}>
                      {fmt(Math.abs(t.amount))}
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-faint)" }}>
                      {shortDate(t.date)}
                    </span>
                    <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-faint)" }}>
                      chevron_right
                    </span>
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
