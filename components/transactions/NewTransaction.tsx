"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import {
  useAccounts,
  useCategories,
  useAddTransaction,
} from "@/hooks/useSupabaseData";
import { CategoryPicker, CategoryField } from "@/components/transactions/CategoryPicker";
import { BUCKETS } from "@/lib/buckets";
import type { TransactionType, BucketType } from "@/lib/types";

interface Props {
  onClose: () => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function NewTransaction({ onClose }: Props) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const add = useAddTransaction();

  const [type, setType] = useState<TransactionType>("expense");
  const [amount, setAmount] = useState("");
  const [merchant, setMerchant] = useState("");
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [bucket, setBucket] = useState<BucketType>("needs");
  const [showPicker, setShowPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsCategory = type === "expense";
  const selectedCategory = categories.find((c) => c.id === categoryId);

  // Picking a category pre-fills the bucket with that category's default,
  // which the user can then override below.
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

    // expense = outflow (negative); income = inflow (positive)
    const signed = type === "expense" ? -Math.abs(num) : Math.abs(num);

    const cat = categories.find((c) => c.id === categoryId);

    try {
      await add.mutateAsync({
        account_id: accountId,
        date,
        amount: signed,
        merchant: merchant.trim() || null,
        type,
        reviewed: true,
        splits:
          needsCategory && cat
            ? [{ category_id: cat.id, bucket, amount: signed }]
            : undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save transaction.");
    }
  }

  if (accounts.length === 0) {
    return (
      <Sheet title="New transaction" onClose={onClose}>
        <div className="px-5 py-8 text-center space-y-3">
          <p style={{ color: "var(--color-muted)" }}>
            Add an account first so transactions have somewhere to live.
          </p>
          <Button onClick={onClose}>Got it</Button>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title="New transaction" onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        {/* type */}
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

        <Input
          label="Amount"
          placeholder="0.00"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <Input
          label={type === "income" ? "Source" : "Merchant"}
          placeholder={type === "income" ? "e.g. Paycheck" : "e.g. Kroger"}
          value={merchant}
          onChange={(e) => setMerchant(e.target.value)}
        />

        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />

        {/* account */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
            Account
          </p>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <Chip
                key={a.id}
                active={accountId === a.id}
                onClick={() => setAccountId(a.id)}
              >
                {a.name}
              </Chip>
            ))}
          </div>
        </div>

        {/* category (expense only) */}
        {needsCategory && (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
              Category
            </p>
            <CategoryField category={selectedCategory} onOpen={() => setShowPicker(true)} />
          </div>
        )}

        {/* bucket — pre-filled from the category, override here */}
        {needsCategory && categoryId && (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
              Bucket
            </p>
            <div className="flex gap-2">
              {(Object.keys(BUCKETS) as BucketType[]).map((b) => (
                <Chip
                  key={b}
                  active={bucket === b}
                  color={BUCKETS[b].color}
                  onClick={() => setBucket(b)}
                >
                  {BUCKETS[b].label}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <Button fullWidth onClick={save} disabled={add.isPending}>
          {add.isPending ? "Saving…" : "Add transaction"}
        </Button>
      </div>

      {showPicker && (
        <CategoryPicker
          selectedId={categoryId}
          onPick={(c) => pickCategory(c.id, c.bucket)}
          onClose={() => setShowPicker(false)}
        />
      )}
    </Sheet>
  );
}
