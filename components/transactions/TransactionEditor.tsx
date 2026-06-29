"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import {
  useAccounts,
  useCategories,
  useUpdateTransaction,
  useDeleteTransaction,
} from "@/hooks/useSupabaseData";
import { BUCKETS } from "@/lib/buckets";
import type { Transaction, TransactionType, BucketType } from "@/lib/types";

interface Props {
  txn: Transaction;
  onClose: () => void;
}

export function TransactionEditor({ txn, onClose }: Props) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const update = useUpdateTransaction();
  const del = useDeleteTransaction();

  const firstSplit = (txn.splits ?? [])[0];
  const isEditableType = txn.type === "expense" || txn.type === "income";

  const [type, setType] = useState<TransactionType>(txn.type);
  const [amount, setAmount] = useState(String(Math.abs(txn.amount)));
  const [merchant, setMerchant] = useState(txn.merchant ?? "");
  const [date, setDate] = useState(txn.date);
  const [accountId, setAccountId] = useState(txn.account_id);
  const [categoryId, setCategoryId] = useState(firstSplit?.category_id ?? "");
  const [bucket, setBucket] = useState<BucketType>(firstSplit?.bucket ?? "needs");
  const [notes, setNotes] = useState(txn.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const needsCategory = type === "expense" || type === "refund";

  function pickCategory(id: string, defaultBucket: BucketType) {
    setCategoryId(id);
    setBucket(defaultBucket);
  }

  async function save() {
    setError(null);
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) return setError("Enter an amount greater than 0.");
    if (!accountId) return setError("Choose an account.");
    if (needsCategory && !categoryId) return setError("Choose a category.");

    // Outflows (expense) are negative; inflows (income/refund) positive.
    const signed = type === "expense" ? -Math.abs(num) : Math.abs(num);

    try {
      await update.mutateAsync({
        id: txn.id,
        account_id: accountId,
        date,
        amount: signed,
        merchant: merchant.trim() || null,
        type,
        notes: notes.trim() || null,
        splits: needsCategory && categoryId
          ? [{ category_id: categoryId, bucket, amount: signed }]
          : undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save transaction.");
    }
  }

  async function remove() {
    if (!confirm("Delete this transaction?")) return;
    try {
      await del.mutateAsync(txn.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete transaction.");
    }
  }

  return (
    <Sheet title="Edit transaction" onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        {!isEditableType && (
          <p
            className="text-xs rounded-lg px-3 py-2"
            style={{ background: "var(--color-chip-bg)", color: "var(--color-muted)" }}
          >
            This is a {txn.type}. You can edit its details below or delete it.
          </p>
        )}

        {/* type (expense / income) */}
        {isEditableType && (
          <div className="flex gap-2">
            <Chip active={type === "expense"} onClick={() => setType("expense")}>
              Expense
            </Chip>
            <Chip
              active={type === "income"}
              color="var(--color-positive)"
              onClick={() => setType("income")}
            >
              Income
            </Chip>
          </div>
        )}

        <Input
          label="Amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <Input
          label={type === "income" ? "Source" : "Merchant"}
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />

        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />

        {/* account */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
            Account
          </p>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <Chip key={a.id} active={accountId === a.id} onClick={() => setAccountId(a.id)}>
                {a.name}
              </Chip>
            ))}
          </div>
        </div>

        {/* category + bucket */}
        {needsCategory && (
          <>
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
                Category
              </p>
              <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                {categories.map((c) => (
                  <Chip
                    key={c.id}
                    active={categoryId === c.id}
                    color={c.color}
                    onClick={() => pickCategory(c.id, c.bucket)}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                      {c.icon}
                    </span>
                    {c.name}
                  </Chip>
                ))}
              </div>
            </div>

            {categoryId && (
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
            )}
          </>
        )}

        <Input
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
        />

        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          <Button variant="ghost" onClick={remove} disabled={del.isPending}>
            Delete
          </Button>
          <Button fullWidth onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
