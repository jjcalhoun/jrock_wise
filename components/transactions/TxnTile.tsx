"use client";

import { fmt, shortDate } from "@/lib/format";
import { isInterestPaid } from "@/lib/interestPaid";
import type { Transaction, Category } from "@/lib/types";

interface Props {
  txn: Transaction;
  categoryById: Record<string, Category>;
  onClick?: () => void;
}

export function TxnTile({ txn, categoryById, onClick }: Props) {
  const inflow = txn.amount > 0;
  const split = txn.splits ?? [];
  const isSplit = split.length > 1;
  // Interest charges move the account balance but are excluded from the budget.
  const balanceOnly = isInterestPaid(txn);
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

  // Reviewed → solid border in the accent color; unreviewed → dashed grey.
  const accent =
    txn.type === "transfer"
      ? "var(--color-transfer)"
      : txn.type === "income" || txn.type === "refund"
        ? "var(--color-positive)"
        : firstCat?.color ?? "var(--color-faint)";

  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[12px] p-3 flex flex-col gap-2 text-left w-full active:opacity-70 transition-opacity"
      style={{
        background: "var(--color-surface)",
        border: txn.reviewed
          ? `1.5px solid ${accent}`
          : "1.5px dashed var(--color-faint)",
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
        {balanceOnly && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{ background: "var(--color-chip-bg)", color: "var(--color-muted)" }}
            title="Interest — affects the account balance only, not your budget"
          >
            BALANCE ONLY
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
    </button>
  );
}
