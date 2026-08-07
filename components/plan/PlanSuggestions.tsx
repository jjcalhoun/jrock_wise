"use client";

import { useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useTransactions, useAccounts } from "@/hooks/useSupabaseData";
import {
  useSeries,
  useUpsertSeries,
  useDismissedSuggestions,
  useDismissSuggestion,
} from "@/hooks/useSeries";
import { kindToType } from "@/lib/commitments/series";
import type { CommitmentKind } from "@/lib/commitments/types";
import { findDuplicateSeries, type SeriesLike } from "@/lib/commitments/duplicates";
import { detectRecurring, type RecurringSuggestion } from "@/lib/recurringDetect";
import { fmt } from "@/lib/format";

/* Two nudges that belong beside the month you're looking at, not on a separate
   settings screen: charges that look recurring but aren't planned, and series
   that look like the same bill twice.

   The duplicate prompt exists because that failure is silent otherwise — two
   rules for one bill quietly double-count it, and the only way it was ever
   found was by reading the database. */

/* A detected transfer says where the money went; the destination account says
   what that means. Paying a loan is a debt payment, not savings — and getting
   that wrong is exactly how five loans ended up accruing interest with nothing
   posted against them. */
function suggestionKind(
  s: RecurringSuggestion,
  accountType: (id: string | null) => string | undefined,
): CommitmentKind {
  if (s.type === "income") return "income";
  if (s.type !== "transfer") return "bill";
  switch (accountType(s.transfer_account_id)) {
    case "loan":
      return "debt";
    case "credit":
      return "cc_payment";
    case "savings":
      return "savings";
    default:
      return "bill";
  }
}

export function PlanSuggestions({
  period,
  onEdit,
}: {
  period: string;
  onEdit: (seriesId: string) => void;
}) {
  const { data: transactions = [] } = useTransactions();
  const { data: accounts = [] } = useAccounts();
  const { data: series = [] } = useSeries();
  const { data: dismissed } = useDismissedSuggestions();
  const upsert = useUpsertSeries();
  const dismiss = useDismissSuggestion();

  // What already has a plan line, in the shape detection compares against.
  const planned = useMemo(
    () =>
      series
        .filter((c) => !!c.account_id)
        .map((c) => ({
          account_id: c.account_id as string,
          type: kindToType(c.kind, c.transfer_account_id),
          name: c.name,
          active: !c.series_ended,
        })),
    [series],
  );

  const suggestions = useMemo(
    () => detectRecurring(transactions, planned, new Set(dismissed ?? [])),
    [transactions, planned, dismissed],
  );

  const duplicates = useMemo(() => {
    const rows: SeriesLike[] = series.map((c) => ({
      id: c.series_id,
      name: c.name,
      account_id: c.account_id ?? "",
      amount: c.amount,
      frequency: c.frequency,
      live: !c.series_ended,
    }));
    return findDuplicateSeries(rows);
  }, [series]);

  function add(s: RecurringSuggestion) {
    upsert.mutate({
      period,
      input: {
        name: s.name,
        kind: suggestionKind(s, (id) => accounts.find((a) => a.id === id)?.type),
        amount: Math.abs(s.amount),
        account_id: s.account_id,
        transfer_account_id: s.transfer_account_id,
        category_id: s.category_id,
        bucket: s.bucket,
        frequency: s.frequency,
        day_of_month: s.day_of_month,
        weekday: s.weekday,
        interval: 1,
      },
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
