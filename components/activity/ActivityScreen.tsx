"use client";

import { useMemo, useState } from "react";
import {
  useTransactions,
  useCategories,
} from "@/hooks/useSupabaseData";
import { TxnTile } from "@/components/transactions/TxnTile";
import { NewTransaction } from "@/components/transactions/NewTransaction";
import { TransactionEditor } from "@/components/transactions/TransactionEditor";
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
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);

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
        <Button size="sm" onClick={() => setShowNew(true)}>
          + New
        </Button>
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
      {editTxn && (
        <TransactionEditor txn={editTxn} onClose={() => setEditTxn(null)} />
      )}
    </main>
  );
}
