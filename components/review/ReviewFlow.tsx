"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useTransactions,
  useCategories,
  useAccounts,
  useReviewTransaction,
} from "@/hooks/useSupabaseData";
import { CategoryGrid } from "@/components/transactions/CategoryGrid";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { BUCKETS } from "@/lib/buckets";
import { fmt, shortDate } from "@/lib/format";
import type { Transaction, TransactionType, BucketType } from "@/lib/types";

export function ReviewFlow({ onClose }: { onClose: () => void }) {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const review = useReviewTransaction();

  // snapshot the queue once so it stays stable as we review through it
  const [queue, setQueue] = useState<Transaction[]>([]);
  const unreviewed = useMemo(() => transactions.filter((t) => !t.reviewed), [transactions]);
  useEffect(() => {
    if (queue.length === 0 && unreviewed.length > 0) setQueue(unreviewed);
  }, [unreviewed, queue.length]);

  const [index, setIndex] = useState(0);

  const txn = queue[index];
  const inflow = txn ? txn.amount > 0 : false;

  // per-transaction selections
  const [type, setType] = useState<TransactionType>("expense");
  const [categoryId, setCategoryId] = useState("");
  const [bucket, setBucket] = useState<BucketType>("needs");
  const [transferAccountId, setTransferAccountId] = useState("");

  // reset selections whenever the current transaction changes
  useEffect(() => {
    if (!txn) return;
    setType(txn.amount > 0 ? "income" : "expense");
    setCategoryId("");
    setBucket("needs");
    setTransferAccountId("");
  }, [txn]);

  const typeOptions: TransactionType[] = inflow
    ? ["income", "refund", "transfer"]
    : ["expense", "transfer"];
  const needsCategory = type === "expense" || type === "refund";
  const otherAccounts = accounts.filter((a) => a.id !== txn?.account_id);

  function pickCategory(id: string, defaultBucket: BucketType) {
    setCategoryId(id);
    setBucket(defaultBucket);
  }

  const canSave =
    type === "income" ||
    (needsCategory && !!categoryId) ||
    (type === "transfer" && !!transferAccountId);

  async function save() {
    if (!txn || !canSave) return;
    await review.mutateAsync({
      id: txn.id,
      type,
      transfer_account_id: type === "transfer" ? transferAccountId : null,
      splits: needsCategory && categoryId
        ? [{ category_id: categoryId, bucket, amount: txn.amount }]
        : undefined,
    });
    setIndex((i) => i + 1);
  }

  const done = queue.length > 0 && index >= queue.length;
  const empty = queue.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-center scrim">
      <div
        className="w-full max-w-[430px] h-full flex flex-col"
        style={{ background: "var(--color-canvas)" }}
      >
      {/* header */}
      <div className="flex items-center justify-between px-4 py-4 border-b" style={{ borderColor: "var(--color-hairline)" }}>
        <button onClick={onClose} style={{ color: "var(--color-muted)" }}>
          <span className="material-symbols-outlined">close</span>
        </button>
        <span className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Review
        </span>
        <span className="text-xs" style={{ color: "var(--color-faint)" }}>
          {!done && !empty ? `${index + 1} of ${queue.length}` : ""}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {empty || done ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
            <span className="material-symbols-outlined" style={{ fontSize: 56, color: "var(--color-positive)" }}>
              task_alt
            </span>
            <p className="font-figure text-xl font-bold" style={{ color: "var(--color-text)" }}>
              All caught up
            </p>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              {empty ? "Nothing to review right now." : "You've reviewed every transaction."}
            </p>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* the transaction card */}
            <div
              className="rounded-[16px] border p-5"
              style={{ background: "var(--color-surface)", borderColor: "var(--color-hairline)" }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
                    {txn.merchant || txn.description || "Transaction"}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--color-faint)" }}>
                    {shortDate(txn.date)}
                  </p>
                </div>
                <p
                  className="font-figure text-2xl font-bold"
                  style={{ color: inflow ? "var(--color-positive)" : "var(--color-text)" }}
                >
                  {fmt(txn.amount)}
                </p>
              </div>
            </div>

            {/* type selector */}
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
                Type
              </p>
              <div className="flex gap-2">
                {typeOptions.map((t) => (
                  <Chip
                    key={t}
                    active={type === t}
                    color={t === "transfer" ? "var(--color-transfer)" : t === "income" || t === "refund" ? "var(--color-positive)" : "var(--color-primary)"}
                    onClick={() => setType(t)}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                  </Chip>
                ))}
              </div>
            </div>

            {/* bucket (above) + category grid (inline) */}
            {needsCategory && (
              <>
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
                    Bucket
                  </p>
                  <div className="flex gap-2">
                    {(Object.keys(BUCKETS) as BucketType[]).map((b) => (
                      <Chip key={b} active={bucket === b} color={BUCKETS[b].color} onClick={() => setBucket(b)}>
                        {BUCKETS[b].label}
                      </Chip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
                    Category
                  </p>
                  <CategoryGrid
                    categories={categories}
                    selectedId={categoryId}
                    onPick={(c) => pickCategory(c.id, c.bucket)}
                  />
                </div>
              </>
            )}

            {/* transfer pairing */}
            {type === "transfer" && (
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
                  {inflow ? "Transferred from" : "Transferred to"}
                </p>
                {otherAccounts.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--color-faint)" }}>
                    Add another account to pair transfers.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {otherAccounts.map((a) => (
                      <Chip key={a.id} active={transferAccountId === a.id} color="var(--color-transfer)" onClick={() => setTransferAccountId(a.id)}>
                        {a.name}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            )}

            {type === "income" && (
              <p className="text-sm" style={{ color: "var(--color-faint)" }}>
                Income needs no category — just save.
              </p>
            )}
          </div>
        )}
      </div>

      {/* controls */}
      {!done && !empty && (
        <div className="border-t px-4 py-3 flex items-center gap-3" style={{ borderColor: "var(--color-hairline)" }}>
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="flex items-center gap-1 text-sm disabled:opacity-40"
            style={{ color: "var(--color-muted)" }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>undo</span>
            Undo
          </button>
          <button
            onClick={() => setIndex((i) => i + 1)}
            className="text-sm ml-2"
            style={{ color: "var(--color-muted)" }}
          >
            Skip
          </button>
          <div className="flex-1" />
          <Button onClick={save} disabled={!canSave || review.isPending}>
            {review.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
      </div>
    </div>
  );
}
