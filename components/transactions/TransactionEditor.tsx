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
  useResolveTransfer,
} from "@/hooks/useSupabaseData";
import { CategoryGrid } from "@/components/transactions/CategoryGrid";
import { isInterestPaid } from "@/lib/interestPaid";
import { BUCKETS } from "@/lib/buckets";
import type { Transaction, TransactionType, BucketType } from "@/lib/types";

interface Props {
  txn: Transaction;
  onClose: () => void;
  inline?: boolean; // render the bare form (no Sheet) for the desktop side panel
}

const TYPE_LABEL: Record<TransactionType, string> = {
  expense: "Expense",
  income: "Income",
  transfer: "Transfer",
  refund: "Refund",
};

export function TransactionEditor({ txn, onClose, inline }: Props) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const update = useUpdateTransaction();
  const del = useDeleteTransaction();
  const resolveTransfer = useResolveTransfer();

  const firstSplit = (txn.splits ?? [])[0];

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

  // Interest charges affect the account balance only — they carry no category
  // split and are excluded from the budget, so we don't prompt for a category.
  const balanceOnly = isInterestPaid(txn);
  const needsCategory = (type === "expense" || type === "refund") && !balanceOnly;
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

    if (type === "transfer" && !transferAccountId) return setError("Choose the transfer account.");

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
      // For transfers, link the counterpart. Savings-bucket impact is derived
      // from account types at read time, so there's nothing to designate here.
      if (type === "transfer" && transferAccountId) {
        await resolveTransfer.mutateAsync({ id: txn.id, transfer_account_id: transferAccountId });
      }
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

  const body = (
      <div className="px-5 py-4 space-y-4">
        {balanceOnly && (
          <div
            className="rounded-[10px] px-3 py-2.5 text-xs"
            style={{ background: "var(--color-chip-bg)", color: "var(--color-muted)" }}
          >
            Interest charge — this affects the account balance only. It’s excluded
            from your spending and Net available, so there’s no category to set.
          </div>
        )}
        {/* type — fully editable across all four types */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
            Type
          </p>
          <div className="flex flex-wrap gap-2">
            {(["expense", "income", "transfer", "refund"] as TransactionType[]).map((t) => (
              <Chip
                key={t}
                active={type === t}
                color={
                  t === "transfer"
                    ? "var(--color-transfer)"
                    : t === "income" || t === "refund"
                      ? "var(--color-positive)"
                      : "var(--color-primary)"
                }
                onClick={() => setType(t)}
              >
                {TYPE_LABEL[t]}
              </Chip>
            ))}
          </div>
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
                  <Chip
                    key={a.id}
                    active={transferAccountId === a.id}
                    color="var(--color-transfer)"
                    onClick={() => setTransferAccountId(a.id)}
                  >
                    {a.name}
                  </Chip>
                ))}
              </div>
            )}
            <p className="text-xs mt-2" style={{ color: "var(--color-faint)" }}>
              Transfers into a savings account automatically count toward your
              Savings bucket; transfers out subtract from it.
            </p>
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
  );

  if (inline) return body;
  return (
    <Sheet title="Edit transaction" onClose={onClose}>
      {body}
    </Sheet>
  );
}
