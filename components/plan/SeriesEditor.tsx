"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { CategoryGrid } from "@/components/transactions/CategoryGrid";
import { useAccounts, useCategories } from "@/hooks/useSupabaseData";
import { useUpsertSeries, useDeleteSeries } from "@/hooks/useSeries";
import type { Commitment, CommitmentKind } from "@/lib/commitments/types";
import type { RecurringFrequency } from "@/lib/types";

/* Editing one recurring series: what it is, where it's paid from, and how it
   repeats.

   It edits the plan line directly now. There is no rule behind it to keep in
   step — the line IS the series, so saving rebuilds this month's unpaid
   occurrences and clone-forward carries the change into next month on its own.
   Anything already paid keeps the amount it was paid at. */

const FREQS: { value: RecurringFrequency; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "semimonthly", label: "Twice a month" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "weekly", label: "Weekly" },
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* What the money is doing, in the plan's own vocabulary. The old editor asked
   for a transaction "type" and then inferred the kind from the destination
   account, which meant a mortgage could only be a loan payment by accident. */
const KINDS: { value: CommitmentKind; label: string; transfer: boolean }[] = [
  { value: "bill", label: "Bill", transfer: false },
  { value: "income", label: "Income", transfer: false },
  { value: "debt", label: "Loan payment", transfer: true },
  { value: "cc_payment", label: "Card payment", transfer: true },
  { value: "savings", label: "Savings", transfer: true },
];

export function SeriesEditor({
  series,
  period,
  onClose,
}: {
  /** the series' latest occurrence — undefined creates a new one */
  series?: Commitment;
  period: string;
  onClose: () => void;
}) {
  const { data: accounts = [] } = useAccounts();
  const { data: categories = [] } = useCategories();
  const upsert = useUpsertSeries();
  const del = useDeleteSeries();

  const [name, setName] = useState(series?.name ?? "");
  const [accountId, setAccountId] = useState(series?.account_id ?? "");
  const [kind, setKind] = useState<CommitmentKind>(series?.kind ?? "bill");
  const [amount, setAmount] = useState(series ? String(Math.abs(series.amount)) : "");
  const [transferId, setTransferId] = useState(series?.transfer_account_id ?? "");
  const [categoryId, setCategoryId] = useState(series?.category_id ?? "");
  const [freq, setFreq] = useState<RecurringFrequency>(series?.frequency ?? "monthly");
  const [day1, setDay1] = useState(series?.day_of_month ? String(series.day_of_month) : "1");
  const [day2, setDay2] = useState(series?.day_of_month_2 ? String(series.day_of_month_2) : "15");
  const [weekday, setWeekday] = useState(series?.weekday ?? 5);
  const [variable, setVariable] = useState(series?.variable ?? false);
  const [active, setActive] = useState(series ? !series.series_ended : true);
  const [error, setError] = useState<string | null>(null);

  const isTransfer = KINDS.find((k) => k.value === kind)?.transfer ?? false;
  const selectedCat = categories.find((c) => c.id === categoryId);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Give it a name.");
    if (!accountId) return setError("Choose an account.");
    const mag = Math.abs(parseFloat(amount));
    if (isNaN(mag) || mag === 0) return setError("Enter an amount.");
    if (isTransfer && !transferId) return setError("Choose the account being paid.");
    if (kind === "bill" && !categoryId) return setError("Choose a category.");

    try {
      await upsert.mutateAsync({
        seriesId: series?.series_id,
        period,
        input: {
          name: name.trim(),
          kind,
          amount: mag,
          account_id: accountId,
          transfer_account_id: isTransfer ? transferId : null,
          category_id: kind === "bill" ? categoryId : null,
          bucket: kind === "bill" ? selectedCat?.bucket ?? null : null,
          frequency: freq,
          day_of_month: freq === "monthly" || freq === "semimonthly" ? parseInt(day1) : null,
          day_of_month_2: freq === "semimonthly" ? parseInt(day2) : null,
          weekday: freq === "weekly" || freq === "biweekly" ? weekday : null,
          interval: 1,
          variable,
          ended: !active,
        },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  async function remove() {
    if (!series) return;
    if (!confirm(`Delete "${series.name}"? Payments already matched to it are kept.`)) return;
    await del.mutateAsync(series.series_id);
    onClose();
  }

  return (
    <Sheet title={series ? "Edit recurring" : "New recurring"} onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <Input label="Name" placeholder="e.g. Payday allocation" value={name} onChange={(e) => setName(e.target.value)} />

        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>Paid from</p>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <Chip key={a.id} active={accountId === a.id} onClick={() => setAccountId(a.id)}>{a.name}</Chip>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>What it is</p>
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <Chip key={k.value} active={kind === k.value} onClick={() => setKind(k.value)}>
                {k.label}
              </Chip>
            ))}
          </div>
        </div>

        <Input label="Amount" placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />

        {isTransfer && (
          <>
            <div>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
                Paying which account
              </p>
              <div className="flex flex-wrap gap-2">
                {accounts.filter((a) => a.id !== accountId).map((a) => (
                  <Chip key={a.id} active={transferId === a.id} onClick={() => setTransferId(a.id)}>{a.name}</Chip>
                ))}
              </div>
            </div>
            <p className="text-xs" style={{ color: "var(--color-faint)" }}>
              Both accounts move: your cash drops and what you owe is paid down.
              Interest and escrow are charged separately, so the balance falls by
              what actually went to principal.
            </p>
          </>
        )}

        {kind === "bill" && (
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
          <>
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
            <p className="text-xs -mt-2" style={{ color: "var(--color-faint)" }}>
              A hint for ordering, not a deadline — a payment matches whatever
              day it lands on. Use 31 for the last day of the month.
            </p>
          </>
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

        <label className="flex items-center justify-between">
          <span className="text-sm" style={{ color: "var(--color-text)" }}>Amount varies</span>
          <input type="checkbox" checked={variable} onChange={(e) => setVariable(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} />
        </label>
        {series && (
          <label className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--color-text)" }}>Still active</span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} />
          </label>
        )}

        {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}

        <div className="flex gap-3 pt-2">
          {series && (
            <Button variant="ghost" onClick={remove} disabled={del.isPending}>Delete</Button>
          )}
          <Button fullWidth onClick={save} disabled={upsert.isPending}>
            {upsert.isPending ? "Saving…" : series ? "Save" : "Add"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
