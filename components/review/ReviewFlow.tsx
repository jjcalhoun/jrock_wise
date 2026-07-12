"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useTransactions,
  useCategories,
  useAccounts,
  useReviewTransaction,
  useResolveTransfer,
} from "@/hooks/useSupabaseData";
import { useUpsertRecurringRule, useRecurringRules } from "@/hooks/useRecurring";
import { useMonthPlan, useLinkTransaction } from "@/hooks/useMonthPlan";
import { suggestPlanItem } from "@/lib/monthPlan";
import { monthKey } from "@/lib/aggregations";
import { CategoryGrid } from "@/components/transactions/CategoryGrid";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { BUCKETS } from "@/lib/buckets";
import { todayISO } from "@/lib/dates";
import { fmt, shortDate } from "@/lib/format";
import type { Transaction, TransactionType, BucketType, RecurringFrequency } from "@/lib/types";

const REVIEW_FREQ: Record<"monthly" | "biweekly" | "weekly", string> = {
  monthly: "Monthly",
  biweekly: "Every 2 weeks",
  weekly: "Weekly",
};

export function ReviewFlow({ onClose }: { onClose: () => void }) {
  const { data: transactions = [] } = useTransactions();
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();
  const review = useReviewTransaction();
  const resolveTransfer = useResolveTransfer();
  const upsertRule = useUpsertRecurringRule();
  const { data: rules = [] } = useRecurringRules();
  const linkTxn = useLinkTransaction();

  // snapshot the queue once so it stays stable as we review through it
  const [queue, setQueue] = useState<Transaction[]>([]);
  const unreviewed = useMemo(() => transactions.filter((t) => !t.reviewed), [transactions]);
  useEffect(() => {
    if (queue.length === 0 && unreviewed.length > 0) setQueue(unreviewed);
  }, [unreviewed, queue.length]);

  const [index, setIndex] = useState(0);

  // The queue is a snapshot; entries can become reviewed behind our back —
  // e.g. resolving one leg of a transfer auto-reviews the counterpart. Skip
  // those instead of asking the user to review them again.
  const liveById = useMemo(
    () => Object.fromEntries(transactions.map((t) => [t.id, t])),
    [transactions],
  );
  useEffect(() => {
    let i = index;
    while (i < queue.length && (liveById[queue[i].id]?.reviewed ?? false)) i++;
    if (i !== index) setIndex(i);
  }, [index, queue, liveById]);

  const txn = queue[index];
  const inflow = txn ? txn.amount > 0 : false;

  // per-transaction selections
  const [type, setType] = useState<TransactionType>("expense");
  const [categoryId, setCategoryId] = useState("");
  const [bucket, setBucket] = useState<BucketType>("needs");
  const [transferAccountId, setTransferAccountId] = useState("");
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurFreq, setRecurFreq] = useState<RecurringFrequency>("monthly");
  const [planItemIds, setPlanItemIds] = useState<string[]>([]);

  // Month plan for the transaction's month — open (unfilled) items can be
  // matched here so the ledger marks the commitment paid.
  const txnMonth = txn ? monthKey(txn.date) : "";
  const { data: planData } = useMonthPlan(txnMonth);
  const openItems = useMemo(() => {
    const items = planData?.items ?? [];
    const filled = new Set(
      transactions.filter((t) => t.plan_item_id && t.id !== txn?.id).map((t) => t.plan_item_id as string),
    );
    return items.filter((i) => !i.excluded && !filled.has(i.id));
  }, [planData, transactions, txn]);
  const suggested = useMemo(
    () => (txn ? suggestPlanItem(txn, openItems, new Set(openItems.map((i) => i.id))) : null),
    [txn, openItems],
  );

  // Payee memory: if we've previously assigned this merchant as a transfer,
  // pre-suggest the same destination (extra debt payments, checks, etc.).
  const rememberedTransfer = useMemo(() => {
    if (!txn || txn.amount > 0) return null;
    const m = (txn.merchant || txn.description || "").toLowerCase().trim();
    if (!m) return null;
    const prior = transactions.find(
      (t) =>
        t.id !== txn.id &&
        t.reviewed &&
        t.type === "transfer" &&
        t.transfer_account_id &&
        t.account_id === txn.account_id &&
        (t.merchant || t.description || "").toLowerCase().trim() === m,
    );
    return prior?.transfer_account_id ?? null;
  }, [txn, transactions]);

  // reset selections whenever the current transaction changes
  useEffect(() => {
    if (!txn) return;
    if (rememberedTransfer) {
      setType("transfer");
      setTransferAccountId(rememberedTransfer);
    } else {
      setType(txn.amount > 0 ? "income" : "expense");
      setTransferAccountId("");
    }
    setCategoryId("");
    setBucket("needs");
    setMakeRecurring(false);
    setRecurFreq("monthly");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txn]);

  // Preselect the suggested planned payment (user can deselect).
  useEffect(() => {
    setPlanItemIds(suggested ? [suggested.id] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txn, suggested?.id]);

  const togglePlanItem = (id: string) =>
    setPlanItemIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  // An active rule already covering this merchant — show that instead of the
  // "repeat" checkbox, so duplicate rules can't be created from review.
  const coveredBy = useMemo(() => {
    if (!txn) return undefined;
    const normed = (txn.merchant || txn.description || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!normed) return undefined;
    return rules.find((r) => {
      if (!r.active || r.account_id !== txn.account_id) return false;
      const n = r.name.toLowerCase().replace(/\s+/g, " ").trim();
      return !!n && (n === normed || n.includes(normed) || normed.includes(n));
    });
  }, [txn, rules]);

  function pickTransferAccount(id: string) {
    setTransferAccountId(id);
  }

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
    if (type === "transfer") {
      await resolveTransfer.mutateAsync({
        id: txn.id,
        transfer_account_id: transferAccountId,
      });
    } else {
      await review.mutateAsync({
        id: txn.id,
        type,
        transfer_account_id: null,
        splits: needsCategory && categoryId
          ? [{ category_id: categoryId, bucket, amount: txn.amount }]
          : undefined,
      });
    }
    // Link to the planned payment(s) it fulfills (ledger marks them paid;
    // extra selections are retired as covered by this payment).
    if (planItemIds.length > 0) {
      await linkTxn.mutateAsync({
        txnId: txn.id,
        planItemId: planItemIds[0],
        alsoCovered: planItemIds.slice(1),
      });
    }
    // Optionally create a recurring rule from this transaction (future occurrences only).
    if (makeRecurring && type !== "refund" && !coveredBy) {
      const d = new Date(`${txn.date}T00:00:00Z`);
      await upsertRule.mutateAsync({
        name: txn.merchant || txn.description || "Recurring",
        account_id: txn.account_id,
        type: type as "expense" | "income" | "transfer",
        amount: txn.amount,
        transfer_account_id: type === "transfer" ? transferAccountId || null : null,
        category_id: type === "expense" ? categoryId || null : null,
        bucket: type === "expense" ? bucket : null,
        frequency: recurFreq,
        day_of_month: recurFreq === "monthly" ? d.getUTCDate() : null,
        weekday: recurFreq === "weekly" || recurFreq === "biweekly" ? d.getUTCDay() : null,
        interval: 1,
        start_date: txn.date,
        last_generated: todayISO(),
        auto_review: true,
        active: true,
        // Link this transaction to the occurrence it represents (unless the
        // user already picked planned payments above).
        ...(planItemIds.length === 0 ? { _sourceTxn: { id: txn.id, date: txn.date } } : {}),
      });
    }
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
                      <Chip key={a.id} active={transferAccountId === a.id} color="var(--color-transfer)" onClick={() => pickTransferAccount(a.id)}>
                        {a.name}
                      </Chip>
                    ))}
                  </div>
                )}
                <p className="text-xs mt-2" style={{ color: "var(--color-faint)" }}>
                  We'll link the matching transaction on the other account, so you
                  only review this once. Transfers into a savings account count
                  toward your Savings bucket automatically.
                </p>
              </div>
            )}

            {type === "income" && (
              <p className="text-sm" style={{ color: "var(--color-faint)" }}>
                Income needs no category — just save.
              </p>
            )}

            {/* Planned payment match */}
            {type !== "refund" && openItems.length > 0 && (
              <div
                className="rounded-[10px] p-3 space-y-2.5"
                style={{
                  background: "var(--color-surface)",
                  border: planItemIds.length > 0 ? "1px solid var(--color-primary)" : "1px solid transparent",
                }}
              >
                <p className="text-sm" style={{ color: "var(--color-text)" }}>
                  {suggested && planItemIds.length === 1 && planItemIds[0] === suggested.id ? (
                    <>Matched to planned: <span className="font-semibold">{suggested.name}</span>{" "}
                      <span style={{ color: "var(--color-faint)" }}>({fmt(suggested.amount)} planned)</span></>
                  ) : (
                    "Fulfills a planned payment?"
                  )}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Chip active={planItemIds.length === 0} onClick={() => setPlanItemIds([])}>
                    None
                  </Chip>
                  {openItems
                    .filter((i) => (txn.amount > 0) === (i.kind === "income"))
                    .map((i) => (
                      <Chip key={i.id} active={planItemIds.includes(i.id)} onClick={() => togglePlanItem(i.id)}>
                        {i.name}{i.due_date ? ` · ${shortDate(i.due_date)}` : ""} · {fmt(i.amount)}
                      </Chip>
                    ))}
                </div>
                <p className="text-xs" style={{ color: "var(--color-faint)" }}>
                  Pick more than one if this payment covers several occurrences.
                </p>
              </div>
            )}

            {/* Make recurring — hidden when a rule already covers this merchant */}
            {type !== "refund" && coveredBy && (
              <div
                className="rounded-[10px] p-3 flex items-center gap-2"
                style={{ background: "var(--color-surface)" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-primary)" }}>repeat</span>
                <p className="text-sm" style={{ color: "var(--color-text)" }}>
                  Recurring · covered by <span className="font-semibold">“{coveredBy.name}”</span>
                </p>
              </div>
            )}
            {type !== "refund" && !coveredBy && (
              <div className="rounded-[10px] p-3 space-y-2.5" style={{ background: "var(--color-surface)" }}>
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-sm" style={{ color: "var(--color-text)" }}>Repeat this transaction</span>
                  <input
                    type="checkbox"
                    checked={makeRecurring}
                    onChange={(e) => setMakeRecurring(e.target.checked)}
                    style={{ accentColor: "var(--color-primary)" }}
                  />
                </label>
                {makeRecurring && (
                  <div className="flex flex-wrap gap-2">
                    {(["monthly", "biweekly", "weekly"] as const).map((fr) => (
                      <Chip key={fr} active={recurFreq === fr} onClick={() => setRecurFreq(fr)}>
                        {REVIEW_FREQ[fr]}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
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
          <Button onClick={save} disabled={!canSave || review.isPending || resolveTransfer.isPending}>
            {review.isPending || resolveTransfer.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
      </div>
    </div>
  );
}
