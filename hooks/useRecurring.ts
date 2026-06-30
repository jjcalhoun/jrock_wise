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
      const { error } = await supabase
        .from("recurring_rules")
        .upsert({ ...input, user_id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recurring_rules"] }),
  });
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
