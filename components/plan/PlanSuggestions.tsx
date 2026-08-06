"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useTransactions } from "@/hooks/useSupabaseData";
import {
  useRecurringRules,
  useUpsertRecurringRule,
  useDismissedSuggestions,
  useDismissSuggestion,
} from "@/hooks/useRecurring";
import { findDuplicateSeries, type SeriesLike } from "@/lib/commitments/duplicates";
import { detectRecurring, type RecurringSuggestion } from "@/lib/recurringDetect";
import { fmt } from "@/lib/format";

/* Two nudges that belong beside the month you're looking at, not on a separate
   settings screen: charges that look recurring but aren't planned, and series
   that look like the same bill twice.

   The duplicate prompt exists because that failure is silent otherwise — two
   rules for one bill quietly double-count it, and the only way it was ever
   found was by reading the database. */

export function PlanSuggestions({ onEdit }: { onEdit: (ruleId: string) => void }) {
  const { data: transactions = [] } = useTransactions();
  const { data: rules = [] } = useRecurringRules();
  const { data: dismissed } = useDismissedSuggestions();
  const upsert = useUpsertRecurringRule();
  const dismiss = useDismissSuggestion();

  const suggestions = useMemo(
    () => detectRecurring(transactions, rules, new Set(dismissed ?? [])),
    [transactions, rules, dismissed],
  );

  const duplicates = useMemo(() => {
    const series: SeriesLike[] = rules.map((r) => ({
      id: r.id,
      name: r.name,
      account_id: r.account_id,
      amount: r.amount,
      frequency: r.frequency,
      live: r.active,
    }));
    return findDuplicateSeries(series);
  }, [rules]);

  function add(s: RecurringSuggestion) {
    upsert.mutate({
      name: s.name,
      account_id: s.account_id,
      type: s.type,
      amount: s.amount,
      transfer_account_id: s.transfer_account_id,
      category_id: s.category_id,
      bucket: s.bucket,
      frequency: s.frequency,
      day_of_month: s.day_of_month,
      weekday: s.weekday,
      interval: 1,
      start_date: s.lastDate,
      active: true,
      auto_review: true,
    });
  }

  if (suggestions.length === 0 && duplicates.length === 0) return null;

  return (
    <div className="space-y-4">
      {duplicates.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
            Possible duplicates
          </p>
          {duplicates.map((g) => (
            <Card key={g.members.map((m) => m.id).join("|")} className="p-3 space-y-2">
              <p className="text-sm" style={{ color: "var(--color-text)" }}>
                {g.members.length} lines look like the same bill
              </p>
              <div className="space-y-1">
                {g.members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onEdit(m.id)}
                    className="flex w-full items-center justify-between text-left text-sm py-1"
                  >
                    <span className="truncate" style={{ color: "var(--color-text)" }}>{m.name}</span>
                    <span className="font-figure shrink-0" style={{ color: "var(--color-muted)" }}>
                      {fmt(m.amount)}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs" style={{ color: "var(--color-faint)" }}>
                {g.reasons.join(" · ")}. Open the one you don&apos;t want and end it —
                its history stays put.
              </p>
            </Card>
          ))}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
            Looks recurring
          </p>
          {suggestions.map((s) => (
            <Card key={s.signature} className="p-3 space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>{s.name}</p>
                <span className="font-figure text-sm shrink-0" style={{ color: "var(--color-muted)" }}>
                  {fmt(s.amount)}
                </span>
              </div>
              <p className="text-xs" style={{ color: "var(--color-faint)" }}>
                {s.count} times, {s.frequency}
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => add(s)} disabled={upsert.isPending}>
                  Add to plan
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => dismiss.mutate(s.signature)}
                  disabled={dismiss.isPending}
                >
                  Not recurring
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
