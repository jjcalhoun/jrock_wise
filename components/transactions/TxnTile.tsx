"use client";

import { fmt, shortDate } from "@/lib/format";
import type { Transaction, Category } from "@/lib/types";

interface Props {
  txn: Transaction;
  categoryById: Record<string, Category>;
}

export function TxnTile({ txn, categoryById }: Props) {
  const inflow = txn.amount > 0;
  const split = txn.splits ?? [];
  const isSplit = split.length > 1;
  const firstCat = split[0] ? categoryById[split[0].category_id] : undefined;

  const color =
    txn.type === "transfer"
      ? "var(--color-transfer)"
      : firstCat?.color ?? "var(--color-faint)";

  const icon =
    txn.type === "transfer"
      ? "swap_horiz"
      : txn.type === "income"
        ? "payments"
        : txn.type === "refund"
          ? "undo"
          : (firstCat?.icon ?? "receipt_long");

  const label =
    txn.merchant ||
    (txn.type === "transfer" ? "Transfer" : firstCat?.name ?? "Uncategorized");

  return (
    <div
      className="rounded-[12px] border p-3 flex flex-col gap-2"
      style={{
        background: "var(--color-surface)",
        borderColor: "var(--color-hairline)",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="inline-flex items-center justify-center w-8 h-8 rounded-full"
          style={{ background: `${color}22` }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 18, color }}
          >
            {icon}
          </span>
        </span>
        {isSplit && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "var(--color-chip-bg)", color: "var(--color-muted)" }}
          >
            SPLIT
          </span>
        )}
      </div>

      <div className="min-w-0">
        <p
          className="text-xs font-medium truncate"
          style={{ color: "var(--color-text)" }}
        >
          {label}
        </p>
        <p
          className="font-figure text-sm font-semibold"
          style={{ color: inflow ? "var(--color-positive)" : "var(--color-text)" }}
        >
          {fmt(txn.amount)}
        </p>
        <p className="text-[10px]" style={{ color: "var(--color-faint)" }}>
          {shortDate(txn.date)}
        </p>
      </div>
    </div>
  );
}
