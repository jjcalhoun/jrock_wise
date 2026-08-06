"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { RecurringRule } from "@/lib/types";

const supabase = createClient();

async function currentUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

export function useRecurringRules() {
  return useQuery({
    queryKey: ["recurring_rules"],
    queryFn: async (): Promise<RecurringRule[]> => {
      const { data, error } = await supabase
        .from("recurring_rules")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as RecurringRule[];
    },
  });
}

export type RecurringRuleInput = Partial<RecurringRule> & {
  name: string;
  account_id: string;
  type: RecurringRule["type"];
  amount: number;
  frequency: RecurringRule["frequency"];
  start_date: string;
  /** The transaction this rule was created from ("repeat this transaction"):
   *  it gets linked to its month-plan occurrence so it counts as paid. */
  _sourceTxn?: { id: string; date: string };
};

export function useUpsertRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecurringRuleInput & { id?: string }) => {
      const user_id = await currentUserId();
      const { _sourceTxn, ...rule } = input;
      const isNew = !rule.id;
      const { data: row, error } = await supabase
        .from("recurring_rules")
        .upsert({ ...rule, user_id })
        .select("id")
        .single();
      if (error) throw error;
      // A rule created mid-month appends this month's occurrences to the
      // current plan (the plan is a snapshot — next months draft it
      // automatically, but this month already exists).
      if (isNew && row && rule.active !== false) {
        await appendRuleToCurrentPlan(user_id, { ...rule, id: row.id as string }, _sourceTxn);
      }
      // Pausing a rule releases its not-yet-paid upcoming commitments so they
      // stop dragging free-to-spend down.
      if (!isNew && input.id && input.active === false) {
        await excludeUnpaidFutureItems(input.id);
      } else if (!isNew && input.id) {
        await syncSeriesFromRule({ ...rule, id: input.id });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_rules"] });
      qc.invalidateQueries({ queryKey: ["commitments"] });
      qc.invalidateQueries({ queryKey: ["commitments_window"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

async function appendRuleToCurrentPlan(
  user_id: string,
  rule: Omit<RecurringRuleInput, "_sourceTxn"> & { id: string },
  sourceTxn?: { id: string; date: string },
) {
  const { occurrences } = await import("@/lib/recurring");
  const { ruleKind, isVariableRule } = await import("@/lib/monthPlan");
  const { todayISO, endOfMonthISO } = await import("@/lib/dates");

  const today = todayISO();
  const period = today.slice(0, 7);

  const { data: accounts } = await supabase.from("accounts").select("id, type");
  const accountById = Object.fromEntries((accounts ?? []).map((a) => [a.id as string, a]));
  const kind = ruleKind(
    { type: rule.type, transfer_account_id: rule.transfer_account_id ?? null },
    accountById,
  );
  if (!kind) return; // cash-neutral shuffle

  // A series already materialized for this period needs nothing more.
  const { data: existing } = await supabase
    .from("commitments")
    .select("id")
    .eq("series_id", rule.id)
    .eq("period", period);
  if ((existing ?? []).length > 0) return;

  // The WHOLE period's occurrences — including ones already past, so a rule
  // created after its due date still has a line the real payment can fill.
  const dates = occurrences(
    {
      frequency: rule.frequency,
      day_of_month: rule.day_of_month,
      day_of_month_2: rule.day_of_month_2,
      weekday: rule.weekday,
      interval: rule.interval ?? 1,
      start_date: rule.start_date,
      end_date: rule.end_date ?? null,
    },
    `${period}-01`,
    endOfMonthISO(),
  );
  // A monthly commitment with no computable day still deserves its line — the
  // date is a hint, so "sometime this month" is a legitimate expectation.
  const hints: (string | null)[] = dates.length > 0 ? dates : [null];

  // Variable bills (history varies >5%) always confirm in review.
  let variable = false;
  if (kind !== "income") {
    const { data: hist } = await supabase
      .from("transactions")
      .select("account_id, merchant, description, amount")
      .eq("account_id", rule.account_id)
      .order("date", { ascending: false })
      .limit(120);
    variable = isVariableRule(rule, hist ?? []);
  }

  const mag = Math.abs(rule.amount);
  const { data: inserted } = await supabase
    .from("commitments")
    .insert(
      hints.map((due_hint, seq) => ({
        user_id,
        series_id: rule.id, // the rule's id IS its series id
        period,
        seq,
        name: rule.name,
        kind,
        amount: kind === "income" ? mag : -mag,
        account_id: rule.account_id,
        transfer_account_id: rule.transfer_account_id ?? null,
        category_id: rule.category_id ?? null,
        bucket: rule.bucket ?? null,
        due_hint,
        frequency: rule.frequency,
        day_of_month: rule.day_of_month ?? null,
        day_of_month_2: rule.day_of_month_2 ?? null,
        weekday: rule.weekday ?? null,
        interval: rule.interval ?? 1,
        series_ended: rule.active === false,
        variable,
      })),
    )
    .select("id, due_hint");

  // Link the spawning transaction to its nearest occurrence, so that one reads
  // as paid instead of double-counting (planned + actual).
  if (sourceTxn && inserted && inserted.length > 0) {
    const target = [...inserted].sort((a, b) => {
      const da = a.due_hint ? Math.abs(Date.parse(a.due_hint as string) - Date.parse(sourceTxn.date)) : Infinity;
      const db = b.due_hint ? Math.abs(Date.parse(b.due_hint as string) - Date.parse(sourceTxn.date)) : Infinity;
      return da - db;
    })[0];
    await supabase
      .from("transactions")
      .update({ commitment_id: target.id })
      .eq("id", sourceTxn.id)
      .is("commitment_id", null);
  }
}

/** Push an edited rule's fields onto its current-period commitments, so the
 *  plan reflects the edit. Only untouched lines are rewritten: anything the
 *  user skipped, re-priced, or already matched keeps what it has. */
async function syncSeriesFromRule(rule: Omit<RecurringRuleInput, "_sourceTxn"> & { id: string }) {
  const { todayISO } = await import("@/lib/dates");
  const period = todayISO().slice(0, 7);
  const mag = Math.abs(rule.amount);
  const { data: rows } = await supabase
    .from("commitments")
    .select("id, kind")
    .eq("series_id", rule.id)
    .eq("period", period)
    .eq("skipped", false);
  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length === 0) return;

  const { data: linked } = await supabase
    .from("transactions")
    .select("commitment_id")
    .in("commitment_id", ids);
  const taken = new Set((linked ?? []).map((t) => t.commitment_id as string));
  const free = ids.filter((id) => !taken.has(id));
  if (free.length === 0) return;

  const kind = (rows ?? [])[0]?.kind as string | undefined;
  await supabase
    .from("commitments")
    .update({
      name: rule.name,
      amount: kind === "income" ? mag : -mag,
      frequency: rule.frequency,
      day_of_month: rule.day_of_month ?? null,
      day_of_month_2: rule.day_of_month_2 ?? null,
      weekday: rule.weekday ?? null,
      interval: rule.interval ?? 1,
      updated_at: new Date().toISOString(),
    })
    .in("id", free);
}

export function useDeleteRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Release the rule's not-yet-paid commitments BEFORE deleting (the FK
      // nulls rule_id on delete, which would orphan them as anonymous lines).
      await excludeUnpaidFutureItems(id);
      const { error } = await supabase.from("recurring_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_rules"] });
      qc.invalidateQueries({ queryKey: ["commitments"] });
      qc.invalidateQueries({ queryKey: ["commitments_window"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/** End a rule's series (used on pause/delete): no future occurrences, and any
 *  not-yet-paid line left in the current period is skipped so a commitment
 *  nobody will pay stops dragging free-to-spend down. Already-matched lines are
 *  left alone — history stays truthful. */
async function excludeUnpaidFutureItems(ruleId: string) {
  await supabase
    .from("commitments")
    .update({ series_ended: true, updated_at: new Date().toISOString() })
    .eq("series_id", ruleId);

  const { data: rows } = await supabase
    .from("commitments")
    .select("id")
    .eq("series_id", ruleId)
    .eq("skipped", false);
  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length === 0) return;

  const { data: linked } = await supabase
    .from("transactions")
    .select("commitment_id")
    .in("commitment_id", ids);
  const taken = new Set((linked ?? []).map((t) => t.commitment_id as string));
  const toSkip = ids.filter((id) => !taken.has(id));
  if (toSkip.length === 0) return;
  await supabase.from("commitments").update({ skipped: true }).in("id", toSkip);
}

/** Signatures of recurring suggestions the user has dismissed. */
export function useDismissedSuggestions() {
  return useQuery({
    queryKey: ["recurring_dismissals"],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from("recurring_suggestion_dismissals")
        .select("signature");
      if (error) throw error;
      return (data ?? []).map((r) => r.signature as string);
    },
  });
}

export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (signature: string) => {
      const user_id = await currentUserId();
      const { error } = await supabase
        .from("recurring_suggestion_dismissals")
        .upsert({ user_id, signature });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_dismissals"] }),
  });
}

/** Materialize due recurring transactions (server route). */
export function useGenerateRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ inserted: number; errors: string[] }> => {
      const res = await fetch("/api/recurring/generate", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      return json;
    },
    onSuccess: (r) => {
      if (r.inserted > 0) {
        qc.invalidateQueries({ queryKey: ["transactions"] });
        qc.invalidateQueries({ queryKey: ["accounts"] });
        qc.invalidateQueries({ queryKey: ["account_balances"] });
      }
    },
  });
}
