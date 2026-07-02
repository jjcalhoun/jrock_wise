"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { CategoryGrid } from "@/components/transactions/CategoryGrid";
import { useAccounts, useCategories } from "@/hooks/useSupabaseData";
import {
  useRecurringRules,
  useUpsertRecurringRule,
  useDeleteRecurringRule,
  useGenerateRecurring,
} from "@/hooks/useRecurring";
import { fmt } from "@/lib/format";
import type { RecurringRule, RecurringFrequency } from "@/lib/types";

const FREQS: { value: RecurringFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "semimonthly", label: "Twice a month" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "weekly", label: "Weekly" },
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function freqLabel(r: RecurringRule): string {
  if (r.frequency === "monthly") return `Monthly · day ${r.day_of_month}`;
  if (r.frequency === "semimonthly") return `Twice monthly · ${r.day_of_month} & ${r.day_of_month_2}`;
  if (r.frequency === "biweekly") return `Every 2 weeks`;
  return "Weekly";
}

export function RecurringManager({ onClose }: { onClose: () => void }) {
  const { data: rules = [] } = useRecurringRules();
  const generate = useGenerateRecurring();
  const [editing, setEditing] = useState<RecurringRule | "new" | null>(null);

  if (editing) {
    return <RuleEditor rule={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />;
  }

  return (
    <Sheet title="Recurring transactions" onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Predictable transactions that generate automatically — paycheck
          allocations, fixed bills, and the like. They appear up to today and stay
          in sync on each app open.
        </p>

        {rules.length > 0 && (
          <div className="space-y-2">
            {rules.map((r) => (
              <button
                key={r.id}
                onClick={() => setEditing(r)}
                className="w-full flex items-center justify-between rounded-xl border p-3 text-left"
                style={{ background: "var(--color-surface)", borderColor: "var(--color-hairline)" }}
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                    {r.name}
                  </p>
                  <p className="text-xs" style={{ color: "var(--color-faint)" }}>
                    {freqLabel(r)}{r.active ? "" : " · paused"}
                  </p>
                </div>
                <span className="font-figure text-sm" style={{ color: r.amount < 0 ? "var(--color-text)" : "var(--color-positive)" }}>
                  {fmt(r.amount)}
                </span>
              </button>
            ))}
          </div>
        )}

        <Button fullWidth variant="secondary" onClick={() => setEditing("new")}>
          + Add recurring rule
        </Button>

        {rules.length > 0 && (
          <button
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            className="w-full text-xs font-semibold py-1"
            style={{ color: "var(--color-primary)" }}
          >
            {generate.isPending ? "Generating…" : "Generate now"}
          </button>
        )}
      </div>
    </Sheet>
  );
}

const todayISO = () => new Date().toISOString().slice(0, 10);

function RuleEditor({ rule, onClose }: { rule?: RecurringRule; onClose: () => void }) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const upsert = useUpsertRecurringRule();
  const del = useDeleteRecurringRule();

  const [name, setName] = useState(rule?.name ?? "");
  const [accountId, setAccountId] = useState(rule?.account_id ?? "");
  const [type, setType] = useState<RecurringRule["type"]>(rule?.type ?? "expense");
  const [amount, setAmount] = useState(rule ? String(Math.abs(rule.amount)) : "");
  const [inflow, setInflow] = useState(rule ? rule.amount >= 0 : false); // transfer direction
  const [transferId, setTransferId] = useState(rule?.transfer_account_id ?? "");
  const [categoryId, setCategoryId] = useState(rule?.category_id ?? "");
  const [freq, setFreq] = useState<RecurringFrequency>(rule?.frequency ?? "monthly");
  const [day1, setDay1] = useState(rule?.day_of_month ? String(rule.day_of_month) : "1");
  const [day2, setDay2] = useState(rule?.day_of_month_2 ? String(rule.day_of_month_2) : "15");
  const [weekday, setWeekday] = useState(rule?.weekday ?? 5);
  const [startDate, setStartDate] = useState(rule?.start_date ?? todayISO());
  const [endDate, setEndDate] = useState(rule?.end_date ?? "");
  const [autoReview, setAutoReview] = useState(rule?.auto_review ?? true);
  const [active, setActive] = useState(rule?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const selectedCat = categories.find((c) => c.id === categoryId);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Give the rule a name.");
    if (!accountId) return setError("Choose an account.");
    const mag = Math.abs(parseFloat(amount));
    if (isNaN(mag) || mag === 0) return setError("Enter an amount.");
    if (type === "transfer" && !transferId) return setError("Choose the transfer account.");
    if (type !== "transfer" && !categoryId) return setError("Choose a category.");

    // Sign: expense negative, income positive, transfer per direction.
    const signed =
      type === "expense" ? -mag : type === "income" ? mag : inflow ? mag : -mag;

    try {
      await upsert.mutateAsync({
        id: rule?.id,
        name: name.trim(),
        account_id: accountId,
        type,
        amount: signed,
        transfer_account_id: type === "transfer" ? transferId : null,
        category_id: type !== "transfer" ? categoryId : null,
        bucket: type !== "transfer" ? selectedCat?.bucket ?? null : null,
        frequency: freq,
        day_of_month: freq === "monthly" || freq === "semimonthly" ? parseInt(day1) : null,
        day_of_month_2: freq === "semimonthly" ? parseInt(day2) : null,
        weekday: freq === "weekly" || freq === "biweekly" ? weekday : null,
        interval: 1,
        start_date: startDate,
        end_date: endDate || null,
        auto_review: autoReview,
        active,
        // Reactivating a paused rule resumes from today — otherwise the
        // generator would backfill every occurrence "missed" while paused.
        ...(rule && !rule.active && active
          ? { last_generated: new Date().toLocaleDateString("en-CA") }
          : {}),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function remove() {
    if (!rule) return;
    if (!confirm(`Delete "${rule.name}"? Already-generated transactions are kept.`)) return;
    await del.mutateAsync(rule.id);
    onClose();
  }

  return (
    <Sheet title={rule ? "Edit rule" : "New recurring rule"} onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <Input label="Name" placeholder="e.g. Payday allocation" value={name} onChange={(e) => setName(e.target.value)} />

        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>Account</p>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <Chip key={a.id} active={accountId === a.id} onClick={() => setAccountId(a.id)}>{a.name}</Chip>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>Type</p>
          <div className="flex gap-2">
            {(["expense", "income", "transfer"] as const).map((t) => (
              <Chip key={t} active={type === t} onClick={() => setType(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </Chip>
            ))}
          </div>
        </div>

        <Input label="Amount" placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />

        {type === "transfer" && (
          <>
            <div className="flex gap-2">
              <Chip active={inflow} onClick={() => setInflow(true)}>Into this account</Chip>
              <Chip active={!inflow} onClick={() => setInflow(false)}>Out of this account</Chip>
            </div>
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
                {inflow ? "From account" : "To account"}
              </p>
              <div className="flex flex-wrap gap-2">
                {accounts.filter((a) => a.id !== accountId).map((a) => (
                  <Chip key={a.id} active={transferId === a.id} onClick={() => setTransferId(a.id)}>{a.name}</Chip>
                ))}
              </div>
            </div>
          </>
        )}

        {type !== "transfer" && (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>Category</p>
            <CategoryGrid categories={categories} selectedId={categoryId} onPick={(c) => setCategoryId(c.id)} />
          </div>
        )}

        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>Frequency</p>
          <div className="flex flex-wrap gap-2">
            {FREQS.map((f) => (
              <Chip key={f.value} active={freq === f.value} onClick={() => setFreq(f.value)}>{f.label}</Chip>
            ))}
          </div>
        </div>

        {(freq === "monthly" || freq === "semimonthly") && (
          <div className="flex gap-3">
            <div className="flex-1">
              <Input label="Day of month" inputMode="numeric" value={day1} onChange={(e) => setDay1(e.target.value)} />
            </div>
            {freq === "semimonthly" && (
              <div className="flex-1">
                <Input label="Second day" inputMode="numeric" value={day2} onChange={(e) => setDay2(e.target.value)} />
              </div>
            )}
          </div>
        )}
        {(freq === "monthly" || freq === "semimonthly") && (
          <p className="text-xs -mt-2" style={{ color: "var(--color-faint)" }}>
            Use 31 for the last day of the month (auto-clamps to 28–31).
          </p>
        )}

        {(freq === "weekly" || freq === "biweekly") && (
          <div>
            <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>Day of week</p>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map((w, i) => (
                <Chip key={i} active={weekday === i} onClick={() => setWeekday(i)}>{w}</Chip>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <div className="flex-1">
            <Input label="Start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="flex-1">
            <Input label="End date (optional)" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <label className="flex items-center justify-between">
          <span className="text-sm" style={{ color: "var(--color-text)" }}>Auto-mark reviewed</span>
          <input type="checkbox" checked={autoReview} onChange={(e) => setAutoReview(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} />
        </label>
        {rule && (
          <label className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--color-text)" }}>Active</span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} />
          </label>
        )}

        {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}

        <div className="flex gap-3 pt-2">
          {rule && (
            <Button variant="ghost" onClick={remove} disabled={del.isPending}>Delete</Button>
          )}
          <Button fullWidth onClick={save} disabled={upsert.isPending}>
            {upsert.isPending ? "Saving…" : rule ? "Save" : "Add rule"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
