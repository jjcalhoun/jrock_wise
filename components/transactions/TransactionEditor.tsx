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
import { CategoryGrid } from "@/components/transactions/CategoryGrid";
import { BUCKETS } from "@/lib/buckets";
import type { Transaction, TransactionType, BucketType } from "@/lib/types";

interface Props {
  txn: Transaction;
  onClose: () => void;
}

const TYPE_LABEL: Record<TransactionType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  refund: "Refund",
};

export function TransactionEditor({ txn, onClose }: Props) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const update = useUpdateTransaction();
  const del = useDeleteTransaction();

  const firstSplit = (txn.splits ?? [])[0];
  // Expense/income can switch between each other; transfer/refund stay fixed.
  const canSwitchType = txn.type === "expense" || txn.type === "income";

  const [type, setType] = useState<TransactionType>(txn.type);
  const [amount, setAmount] = useState(String(Math.abs(txn.amount)));
  const [merchant, setMerchant] = useState(txn.merchant ?? "");
  const [date, setDate] = useState(txn.date);
  const [accountId, setAccountId] = useState(txn.account_id);
  const [categoryId, setCategoryId] = useState(firstSplit?.category_id ?? "");
  const [bucket, setBucket] = useState<BucketType>(firstSplit?.bucket ?? "needs");
  const [transferAccountId, setTransferAccountId] = useState(txn.transfer_account_id ?? "");
  const [notes, setNotes] = useState(txn.notes ?? "");
  const [error, setError] = useState<string | null>(null);

  const needsCategory = type === "expense" || type === "refund";
  const inflow = txn.amount > 0;
  const otherAccounts = accounts.filter((a) => a.id !== accountId);

  function pickCategory(id: string, defaultBucket: BucketType) {
    setCategoryId(id);
    setBucket(defaultBucket);
  }

  function signedAmount(num: number): number {
    if (type === "expense") return -Math.abs(num);
    if (type === "transfer") return txn.amount < 0 ? -Math.abs(num) : Math.abs(num);
    return Math.abs(num); // income / refund
  }

  async function save() {
    setError(null);
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) return setError("Enter an amount greater than 0.");
    if (!accountId) return setError("Choose an account.");
    if (needsCategory && !categoryId) return setError("Choose a category.");

    const signed = signedAmount(num);
    try {
      await update.mutateAsync({
        id: txn.id,
        account_id: accountId,
        date,
        amount: signed,
        merchant: merchant.trim() || null,
        type,
        transfer_account_id: type === "transfer" ? transferAccountId || null : null,
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
        {/* type — switchable for expense/income, locked for transfer/refund */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
            Type
          </p>
          {canSwitchType ? (
            <div className="flex gap-2">
              <Chip active={type === "expense"} onClick={() => setType("expense")}>Expense</Chip>
              <Chip active={type === "income"} color="var(--color-positive)" onClick={() => setType("income")}>
                Income
              </Chip>
            </div>
          ) : (
            <Chip active color={type === "transfer" ? "var(--color-transfer)" : "var(--color-positive)"}>
              {TYPE_LABEL[type]}
            </Chip>
          )}
        </div>

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

        {/* bucket (above) + category grid — expense/refund */}
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
              <CategoryGrid categories={categories} selectedId={categoryId} onPick={(c) => pickCategory(c.id, c.bucket)} />
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
