"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  useTransactions,
  useCategories,
} from "@/hooks/useSupabaseData";
import { useTxnWindow } from "@/components/providers";
import { TxnTile } from "@/components/transactions/TxnTile";
import { NewTransaction } from "@/components/transactions/NewTransaction";
import { TransactionEditor } from "@/components/transactions/TransactionEditor";
import { ReviewFlow } from "@/components/review/ReviewFlow";
import { FilterSheet, EMPTY_FILTERS, activeFilterCount, type ActivityFilters } from "@/components/activity/FilterSheet";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BUCKETS } from "@/lib/buckets";
import { monthKey } from "@/lib/aggregations";
import { monthLabel } from "@/lib/format";
import type { BucketType, Transaction } from "@/lib/types";

export function ActivityScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { data: transactions = [], isLoading } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { ensureSince } = useTxnWindow();
  const [query, setQuery] = useState("");
  const [bucket, setBucket] = useState<BucketType | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [editTxn, setEditTxn] = useState<Transaction | null>(null);

  const years = useMemo(() => {
    const cur = new Date().getFullYear();
    const set = new Set<number>();
    for (let y = cur; y >= cur - 7; y--) set.add(y); // selectable even if not yet loaded
    for (const t of transactions) set.add(Number(t.date.slice(0, 4)));
    return [...set].sort((a, b) => b - a);
  }, [transactions]);
  const filterCount = activeFilterCount(filters);

  // deep-link filters from the Home Income/Spent tiles
  const typeParam = params.get("type"); // "income" | "spending"
  const monthParam = params.get("month"); // "YYYY-MM"
  const hasDeepFilter = typeParam === "income" || typeParam === "spending";

  // expand the loaded window when filters reach older than the default window
  useEffect(() => {
    if (monthParam) ensureSince(`${monthParam}-01`);
    if (filters.from) ensureSince(filters.from);
    if (filters.year) ensureSince(`${filters.year}-01-01`);
    if (filters.month && !filters.year && !filters.from) ensureSince("1970-01-01");
  }, [filters, monthParam, ensureSince]);

  const deepLabel =
    typeParam === "income"
      ? `Income${monthParam ? ` · ${monthLabel(monthParam)}` : ""}`
      : `Spending${monthParam ? ` · ${monthLabel(monthParam)}` : ""}`;

  const unreviewedCount = transactions.filter((t) => !t.reviewed).length;

  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      // deep-link filters (from Home)
      if (monthParam && monthKey(t.date) !== monthParam) return false;
      if (typeParam === "income" && t.type !== "income") return false;
      if (typeParam === "spending" && t.type !== "expense" && t.type !== "refund") return false;
      // search + bucket
      if (query) {
        const hay = `${t.merchant ?? ""} ${t.description ?? ""}`.toLowerCase();
        if (!hay.includes(query.toLowerCase())) return false;
      }
      if (bucket && !(t.splits ?? []).some((s) => s.bucket === bucket)) return false;
      // filter sheet
      if (filters.type !== "all" && t.type !== filters.type) return false;
      if (filters.categoryId && !(t.splits ?? []).some((s) => s.category_id === filters.categoryId)) return false;
      if (filters.year && Number(t.date.slice(0, 4)) !== filters.year) return false;
      if (filters.month && Number(t.date.slice(5, 7)) !== filters.month) return false;
      if (filters.from && t.date < filters.from) return false;
      if (filters.to && t.date > filters.to) return false;
      return true;
    });
  }, [transactions, query, bucket, typeParam, monthParam, filters]);

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

      {hasDeepFilter && (
        <button
          onClick={() => router.push("/activity")}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: "var(--color-primary)", color: "#fff" }}
        >
          {deepLabel}
          <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
        </button>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setShowFilters(true)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-[9999px] text-xs font-semibold"
          style={{
            background: filterCount > 0 ? "var(--color-primary)" : "var(--color-chip-bg)",
            color: filterCount > 0 ? "#fff" : "var(--color-muted)",
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 15 }}>tune</span>
          Filters{filterCount > 0 ? ` · ${filterCount}` : ""}
        </button>
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
        {filterCount > 0 && (
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-xs font-semibold"
            style={{ color: "var(--color-muted)" }}
          >
            Clear
          </button>
        )}
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

      {showFilters && (
        <FilterSheet
          filters={filters}
          categories={categories}
          years={years}
          onApply={setFilters}
          onClose={() => setShowFilters(false)}
        />
      )}
      {showNew && <NewTransaction onClose={() => setShowNew(false)} />}
      {showReview && <ReviewFlow onClose={() => setShowReview(false)} />}
      {editTxn && (
        <TransactionEditor txn={editTxn} onClose={() => setEditTxn(null)} />
      )}
    </main>
  );
}
