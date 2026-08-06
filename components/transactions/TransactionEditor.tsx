"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import {
  useAccounts,
  useCategories,
  useTransactions,
  useUpdateTransaction,
  useDeleteTransaction,
  useResolveTransfer,
} from "@/hooks/useSupabaseData";
import { CategoryGrid } from "@/components/transactions/CategoryGrid";
import { useUpsertRecurringRule, useRecurringRules } from "@/hooks/useRecurring";
import { useCommitmentWindow, useLinkCommitment } from "@/hooks/useCommitments";
import { rankCommitments, suggestCommitment, orderForDisplay } from "@/lib/commitments/match";
import { periodWindow } from "@/lib/commitments/period";
import { commitmentTransferTarget } from "@/lib/commitments/types";
import { monthKey } from "@/lib/aggregations";
import { RecurringManager } from "@/components/settings/RecurringManager";
import { isInterestPaid } from "@/lib/interestPaid";
import { todayISO } from "@/lib/dates";
import { fmt, shortDate } from "@/lib/format";
import { BUCKETS } from "@/lib/buckets";
import type { Transaction, TransactionType, BucketType, RecurringFrequency } from "@/lib/types";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const FREQ_LABEL: Record<"monthly" | "biweekly" | "weekly", string> = {
  monthly: "Monthly",
  biweekly: "Every 2 weeks",
  weekly: "Weekly",
};

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
  const { data: allTxns = [] } = useTransactions();
  const { data: rules = [] } = useRecurringRules();
  const update = useUpdateTransaction();
  const del = useDeleteTransaction();
  const resolveTransfer = useResolveTransfer();
  const upsertRule = useUpsertRecurringRule();
  const linkTxn = useLinkCommitment();

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
  const [makeRecurring, setMakeRecurring] = useState(false);
  const [recurFreq, setRecurFreq] = useState<RecurringFrequency>("monthly");
  const [showRules, setShowRules] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* ---- recurring status ---- */
  // A row our generator created — it IS a rule occurrence; no checkbox.
  const genRuleId = /^recurring:([^:]+):/.exec(txn.external_id ?? "")?.[1] ?? null;
  const isGenerated = txn.source === "recurring" || !!genRuleId;
  const genRule = genRuleId ? rules.find((r) => r.id === genRuleId) : undefined;

  // An active rule already covering this merchant on this account → the box
  // shows CHECKED; unchecking pauses the rule (reversible, keeps history).
  const matchedRule = useMemo(() => {
    if (isGenerated) return undefined;
    const m = norm(txn.merchant || txn.description || "");
    if (!m) return undefined;
    return rules.find((r) => {
      if (!r.active || r.account_id !== txn.account_id || r.type !== txn.type) return false;
      const n = norm(r.name);
      return !!n && (n === m || n.includes(m) || m.includes(n));
    });
  }, [rules, txn, isGenerated]);

  const touchedRecur = useRef(false);
  useEffect(() => {
    if (!touchedRecur.current) setMakeRecurring(!!matchedRule);
  }, [matchedRule]);

  /* ---- planned-payment link ---- */
  const txnMonth = monthKey(txn.date);
  // A window of periods, not just this transaction's month — the due date is a
  // hint, so a payment may fulfill a neighbouring month's commitment.
  const { data: windowItems = [] } = useCommitmentWindow(periodWindow(txnMonth));
  // Scored for pre-selection, shown in date order (see orderForDisplay).
  const candidates = useMemo(
    () => orderForDisplay(rankCommitments(txn, windowItems, { linked: allTxns })),
    [txn, windowItems, allTxns],
  );
  const suggested = useMemo(
    () => (txn.commitment_id ? null : suggestCommitment(txn, windowItems, { linked: allTxns })),
    [txn, windowItems, allTxns],
  );
  const [commitmentId, setCommitmentId] = useState<string | null>(txn.commitment_id ?? null);
  const touchedPlan = useRef(false);
  useEffect(() => {
    if (!touchedPlan.current && !txn.commitment_id && suggested) setCommitmentId(suggested.id);
  }, [suggested, txn.commitment_id]);
  const pickCommitment = (id: string) => {
    touchedPlan.current = true;
    setCommitmentId((cur) => (cur === id ? null : id));
    // A debt / card / savings commitment already knows its destination, so
    // choosing one is enough to say this payment is a transfer.
    const dest = commitmentTransferTarget(windowItems.find((i) => i.id === id));
    if (dest && commitmentId !== id) {
      setType("transfer");
      setTransferAccountId(dest);
    }
  };

  const canRecur = type !== "refund" && !isGenerated; // rules cover expense / income / transfer

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
      if (canRecur) {
        if (matchedRule && !makeRecurring) {
          // Unchecked an already-covered merchant → pause the rule (reversible).
          await upsertRule.mutateAsync({ ...matchedRule, active: false });
        } else if (!matchedRule && makeRecurring) {
          // Spin up a recurring rule from this transaction. It generates FUTURE
          // occurrences only (watermark = today), so this row isn't duplicated.
          const d = new Date(`${date}T00:00:00Z`);
          await upsertRule.mutateAsync({
            name: merchant.trim() || "Recurring",
            account_id: accountId,
            type: type as "expense" | "income" | "transfer",
            amount: signed,
            transfer_account_id: type === "transfer" ? transferAccountId || null : null,
            category_id: type === "expense" ? categoryId || null : null,
            bucket: type === "expense" ? bucket : null,
            frequency: recurFreq,
            day_of_month: recurFreq === "monthly" ? d.getUTCDate() : null,
            weekday: recurFreq === "weekly" || recurFreq === "biweekly" ? d.getUTCDay() : null,
            interval: 1,
            start_date: date,
            last_generated: todayISO(),
            auto_review: true,
            active: true,
            // Link this transaction to the occurrence it represents (unless a
            // planned payment was picked explicitly below).
            ...(commitmentId === null ? { _sourceTxn: { id: txn.id, date } } : {}),
          });
        }
        // matched + still checked → already covered, nothing to create.
      }
      // Planned-payment link changed → write it (None unlinks).
      if (commitmentId !== (txn.commitment_id ?? null)) {
        await linkTxn.mutateAsync({ txnId: txn.id, commitmentId });
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

        {/* Recurring status — generated rows show where they came from */}
        {isGenerated && (
          <div
            className="rounded-[10px] p-3 flex items-center justify-between gap-3"
            style={{ background: "var(--color-elevated)" }}
          >
            <div className="min-w-0">
              <p className="text-sm flex items-center gap-1.5" style={{ color: "var(--color-text)" }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16, color: "var(--color-primary)" }}>repeat</span>
                Recurring
              </p>
              <p className="text-xs mt-0.5" style={{ color: "var(--color-faint)" }}>
                Generated by {genRule ? `“${genRule.name}”` : "a recurring rule"}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setShowRules(true)}>
              Manage
            </Button>
          </div>
        )}

        {/* Make recurring — reflects rule state; unchecking pauses the rule */}
        {canRecur && (
          <div className="rounded-[10px] p-3 space-y-2.5" style={{ background: "var(--color-elevated)" }}>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-sm" style={{ color: "var(--color-text)" }}>
                Repeat this transaction
              </span>
              <input
                type="checkbox"
                checked={makeRecurring}
                onChange={(e) => {
                  touchedRecur.current = true;
                  setMakeRecurring(e.target.checked);
                }}
                style={{ accentColor: "var(--color-primary)" }}
              />
            </label>
            {matchedRule ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs" style={{ color: "var(--color-faint)" }}>
                  {makeRecurring
                    ? `Covered by “${matchedRule.name}” — uncheck to pause that rule.`
                    : `Saving will pause “${matchedRule.name}” (no future occurrences until resumed).`}
                </p>
                <Button size="sm" variant="secondary" onClick={() => setShowRules(true)}>
                  Manage
                </Button>
              </div>
            ) : makeRecurring ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {(["monthly", "biweekly", "weekly"] as const).map((fr) => (
                    <Chip key={fr} active={recurFreq === fr} onClick={() => setRecurFreq(fr)}>
                      {FREQ_LABEL[fr]}
                    </Chip>
                  ))}
                </div>
                <p className="text-xs" style={{ color: "var(--color-faint)" }}>
                  Creates a recurring rule from this transaction. Future occurrences
                  post automatically — this one stays as it is.
                </p>
              </>
            ) : null}
          </div>
        )}

        {/* Planned payment link — mirrors the review flow. Plain chips;
            claimed lines drop to a dimmed "Claimed" group that stays
            selectable so a bad match can be taken back. */}
        {(candidates.length > 0 || txn.commitment_id) && (
          <div
            className="rounded-[10px] p-3 space-y-2.5"
            style={{
              background: "var(--color-elevated)",
              border: commitmentId ? "1px solid var(--color-primary)" : "1px solid transparent",
            }}
          >
            <p className="text-sm" style={{ color: "var(--color-text)" }}>
              {suggested && commitmentId === suggested.id
                ? <>Looks like: <span className="font-semibold">{suggested.name}</span></>
                : "Fulfills a planned payment?"}
            </p>
            <div className="flex flex-wrap gap-2">
              <Chip
                active={commitmentId === null}
                onClick={() => {
                  touchedPlan.current = true;
                  setCommitmentId(null);
                }}
              >
                None
              </Chip>
              {candidates
                .filter((x) => !x.claimedBy)
                .map(({ commitment: i }) => (
                  <Chip key={i.id} active={commitmentId === i.id} onClick={() => pickCommitment(i.id)}>
                    {chipLabel(i)}
                  </Chip>
                ))}
            </div>
            {candidates.some((x) => x.claimedBy) && (
              <>
                <p className="text-xs font-semibold" style={{ color: "var(--color-faint)" }}>
                  Claimed
                </p>
                <div className="flex flex-wrap gap-2">
                  {candidates
                    .filter((x) => x.claimedBy)
                    .map(({ commitment: i }) => (
                      <Chip
                        key={i.id}
                        active={commitmentId === i.id}
                        dim={commitmentId !== i.id}
                        onClick={() => pickCommitment(i.id)}
                      >
                        {chipLabel(i)}
                      </Chip>
                    ))}
                </div>
              </>
            )}
          </div>
        )}

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

  if (inline)
    return (
      <>
        {body}
        {showRules && <RecurringManager onClose={() => setShowRules(false)} />}
      </>
    );
  return (
    <Sheet title="Edit transaction" onClose={onClose}>
      {body}
      {showRules && <RecurringManager onClose={() => setShowRules(false)} />}
    </Sheet>
  );
}

/** Chip text: name, date, amount. Claim state is conveyed by dimming and the
 *  Claimed group, not by words. */
function chipLabel(i: { name: string; due_hint?: string | null; amount: number }): string {
  const parts = [i.name];
  if (i.due_hint) parts.push(shortDate(i.due_hint));
  parts.push(fmt(i.amount));
  return parts.join(" \u00b7 ");
}
