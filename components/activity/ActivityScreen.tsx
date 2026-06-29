"use client";

import { useMemo, useState } from "react";
import {
  useTransactions,
  useCategories,
} from "@/hooks/useSupabaseData";
import { TxnTile } from "@/components/transactions/TxnTile";
import { NewTransaction } from "@/components/transactions/NewTransaction";
import { TransactionEditor } from "@/components/transactions/TransactionEditor";
import { ReviewFlow } from "@/components/review/ReviewFlow";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BUCKETS } from "@/lib/buckets";
import type { BucketType, Transaction } from "@/lib/types";

export function ActivityScreen() {
  const { data: transactions = [], isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<BucketType | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);

  const unreviewedCount = transactions.filter((t) => !t.reviewed).length;

  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (query) {
        const hay = `${t.merchant ?? ""} ${t.description ?? ""}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) return false;
      }
      if (bucket) {
        const splits = t.splits ?? [];
        if (!splits.some((s) => s.bucket === bucket)) return false;
      }
      return true;
    });
  }, [transactions, query, bucket]);

  return (
    <main className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-figure text-xl font-bold" style={{ color: "var(--color-text)" }}>
          Activity
        </h1>
        <div className="flex items-center gap-2">
          {unreviewedCount > 0 && (
            <Button size="sm" onClick={() => setShowReview(true)} className="relative">
              Review
              <span
                className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
                style={{ background: "#fff", color: "var(--color-primary)" }}
              >
                {unreviewedCount}
              </span>
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setShowNew(true)}>
            + New
          </Button>
        </div>
      </div>

      <Input
        placeholder="Search transactions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="flex gap-2">
        {(Object.keys(BUCKETS) as BucketType[]).map((b) => (
          <Chip
            key={b}
            active={bucket === b}
            color={BUCKETS[b].color}
            onClick={() => setBucket(bucket === b ? null : b)}
          >
            {BUCKETS[b].label}
          </Chip>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--color-muted)" }}>
          Loading…
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-center py-8" style={{ color: "var(--color-muted)" }}>
          {transactions.length === 0
            ? "No transactions yet. Tap + New to add one."
            : "No transactions match your filters."}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {filtered.map((t) => (
            <TxnTile
              key={t.id}
              txn={t}
              categoryById={categoryById}
              onClick={() => setEditTxn(t)}
            />
          ))}
        </div>
      )}

      {showNew && <NewTransaction onClose={() => setShowNew(false)} />}
      {showReview && <ReviewFlow onClose={() => setShowReview(false)} />}
      {editTxn && (
        <TransactionEditor txn={editTxn} onClose={() => setEditTxn(null)} />
      )}
    </main>
  );
}
