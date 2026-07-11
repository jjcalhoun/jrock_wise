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
};

export function useUpsertRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RecurringRuleInput & { id?: string }) => {
      const user_id = await currentUserId();
      const isNew = !input.id;
      const { data: row, error } = await supabase
        .from("recurring_rules")
        .upsert({ ...input, user_id })
        .select("id")
        .single();
      if (error) throw error;
      // A rule created mid-month appends its remaining occurrences to the
      // current month's plan (the plan is a snapshot — next months draft it
      // automatically, but this month already exists).
      if (isNew && row && input.active !== false) {
        await appendRuleToCurrentPlan(user_id, { ...input, id: row.id as string });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["recurring_rules"] });
      qc.invalidateQueries({ queryKey: ["month_plan"] });
    },
  });
}

async function appendRuleToCurrentPlan(user_id: string, rule: RecurringRuleInput & { id: string }) {
  const { occurrences } = await import("@/lib/recurring");
  const { ruleKind } = await import("@/lib/monthPlan");
  const { todayISO, endOfMonthISO } = await import("@/lib/dates");

  const today = todayISO();
  const month = today.slice(0, 7);
  const { data: plan } = await supabase
    .from("month_plans")
    .select("id")
    .eq("month", month)
    .maybeSingle();
  if (!plan) return; // no plan yet — the draft will pick the rule up

  const { data: accounts } = await supabase.from("accounts").select("id, type");
  const accountById = Object.fromEntries((accounts ?? []).map((a) => [a.id as string, a]));
  const kind = ruleKind(
    { type: rule.type, transfer_account_id: rule.transfer_account_id ?? null },
    accountById,
  );
  if (!kind) return; // cash-neutral shuffle

  // Only occurrences still ahead of us — the transaction that spawned the rule
  // (if any) already happened and stays part of actual spending.
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
    today,
    endOfMonthISO(),
  ).filter((d) => d > today);
  if (dates.length === 0) return;

  const mag = Math.abs(rule.amount);
  await supabase.from("month_plan_items").insert(
    dates.map((due_date) => ({
      user_id,
      plan_id: plan.id,
      rule_id: rule.id,
      name: rule.name,
      kind,
      amount: kind === "income" ? mag : -mag,
      due_date,
      variable: false,
    })),
  );
}

export function useDeleteRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("recurring_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_rules"] }),
  });
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
