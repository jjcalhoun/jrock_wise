"use client";

import { fmt, shortDate } from "@/lib/format";
import { isInterestPaid } from "@/lib/interestPaid";
import { BUCKETS } from "@/lib/buckets";
import type { Transaction, Category } from "@/lib/types";

interface Props {
  txn: Transaction;
  categoryById: Record<string, Category>;
  accountNameById?: Record<string, string>;
  savingsAccountIds?: Set<string>;
  onClick?: () => void;
}

export function TxnTile({ txn, categoryById, accountNameById, savingsAccountIds, onClick }: Props) {
  const isTransfer = txn.type === "transfer";
  const inflow = txn.amount > 0;
  const split = txn.splits ?? [];
  const isSplit = split.length > 1;
  // Interest charges move the account balance but are excluded from the budget.
  const balanceOnly = isInterestPaid(txn);
  const firstCat = split[0] ? categoryById[split[0].category_id] : undefined;

  // A transfer moves money between two accounts. Show it as one "from → to"
  // line regardless of which side (debit/credit) this row represents.
  const fromId = inflow ? txn.transfer_account_id : txn.account_id;
  const toId = inflow ? txn.account_id : txn.transfer_account_id;
  const nameOf = (id?: string | null) => (id ? accountNameById?.[id] : undefined);
  const transferLabel =
    nameOf(fromId) && nameOf(toId)
      ? `${nameOf(fromId)} → ${nameOf(toId)}`
      : txn.merchant || "Transfer";
  // A transfer INTO a savings account reads as a savings contribution; anything
  // else (incl. money leaving savings) reads as a plain transfer.
  const intoSavings = isTransfer && !!toId && !!savingsAccountIds?.has(toId);

  const color = isTransfer
    ? intoSavings
      ? BUCKETS.savings.color
      : "var(--color-transfer)"
    : firstCat?.color ?? "var(--color-faint)";

  const icon =
    txn.type === "transfer"
      ? intoSavings
        ? "savings"
        : "swap_horiz"
      : txn.type === "income"
        ? "payments"
        : txn.type === "refund"
          ? "undo"
          : (firstCat?.icon ?? "receipt_long");

  const label = isTransfer
    ? transferLabel
    : txn.merchant || firstCat?.name || "Uncategorized";

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
        {isTransfer && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              background: "var(--color-chip-bg)",
              color: intoSavings ? BUCKETS.savings.color : "var(--color-transfer)",
            }}
            title={
              intoSavings
                ? "Transfer into savings — counts toward your Savings bucket"
                : "Transfer between accounts — not counted as income or spending"
            }
          >
            {intoSavings ? "SAVINGS" : "TRANSFER"}
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
          style={{
            color: isTransfer
              ? color
              : inflow
                ? "var(--color-positive)"
                : "var(--color-text)",
          }}
        >
          {isTransfer ? fmt(Math.abs(txn.amount)) : fmt(txn.amount)}
        </p>
        <p className="text-[10px]" style={{ color: "var(--color-faint)" }}>
          {shortDate(txn.date)}
        </p>
      </div>
    </button>
  );
}
