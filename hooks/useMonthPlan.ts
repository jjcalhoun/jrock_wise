"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { MonthPlan, MonthPlanItem } from "@/lib/types";
import type { PlanDraftItem } from "@/lib/monthPlan";

const supabase = createClient();

async function currentUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

export interface MonthPlanWithItems {
  plan: MonthPlan | null;
  items: MonthPlanItem[];
}

export function useMonthPlan(month: string) {
  return useQuery({
    queryKey: ["month_plan", month],
    queryFn: async (): Promise<MonthPlanWithItems> => {
      const { data: plan, error } = await supabase
        .from("month_plans")
        .select("*")
        .eq("month", month)
        .maybeSingle();
      if (error) throw error;
      if (!plan) return { plan: null, items: [] };
      const { data: items, error: iErr } = await supabase
        .from("month_plan_items")
        .select("*")
        .eq("plan_id", plan.id)
        .order("due_date");
      if (iErr) throw iErr;
      return { plan: plan as MonthPlan, items: (items ?? []) as MonthPlanItem[] };
    },
  });
}

/** Create the month's plan from a draft (no-op if one already exists). */
export function useCreatePlanDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ month, draft }: { month: string; draft: PlanDraftItem[] }) => {
      const user_id = await currentUserId();
      const { data: existing } = await supabase
        .from("month_plans")
        .select("id")
        .eq("month", month)
        .maybeSingle();
      if (existing) return existing.id as string;

      const { data: plan, error } = await supabase
        .from("month_plans")
        .insert({ user_id, month })
        .select("id")
        .single();
      if (error || !plan) throw error ?? new Error("Could not create plan");
      if (draft.length > 0) {
        const { error: iErr } = await supabase.from("month_plan_items").insert(
          draft.map((d) => ({ ...d, user_id, plan_id: plan.id })),
        );
        if (iErr) throw iErr;
      }
      return plan.id as string;
    },
    onSuccess: (_id, { month }) => qc.invalidateQueries({ queryKey: ["month_plan", month] }),
  });
}

/** Insert draft items into an existing (empty, unconfirmed) plan — repairs a
    plan that was created before the rules had loaded. */
export function usePopulatePlanItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ month, planId, draft }: { month: string; planId: string; draft: PlanDraftItem[] }) => {
      if (draft.length === 0) return;
      const user_id = await currentUserId();
      // Only ever populate a plan that is still empty (guards double-insert).
      const { count } = await supabase
        .from("month_plan_items")
        .select("id", { count: "exact", head: true })
        .eq("plan_id", planId);
      if ((count ?? 0) > 0) return;
      const { error } = await supabase.from("month_plan_items").insert(
        draft.map((d) => ({ ...d, user_id, plan_id: planId })),
      );
      if (error) throw error;
    },
    onSuccess: (_r, { month }) => qc.invalidateQueries({ queryKey: ["month_plan", month] }),
  });
}

/** Append draft items to an existing plan (no emptiness guard — used to pick
    up rules created after the plan was drafted). */
export function useAppendPlanItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ month, planId, draft }: { month: string; planId: string; draft: PlanDraftItem[] }) => {
      if (draft.length === 0) return;
      const user_id = await currentUserId();
      const { error } = await supabase.from("month_plan_items").insert(
        draft.map((d) => ({ ...d, user_id, plan_id: planId })),
      );
      if (error) throw error;
    },
    onSuccess: (_r, { month }) => qc.invalidateQueries({ queryKey: ["month_plan", month] }),
  });
}

export function useConfirmPlan(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase
        .from("month_plans")
        .update({ confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", planId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["month_plan", month] }),
  });
}

export function useUpdatePlanItem(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string } & Partial<Pick<MonthPlanItem, "amount" | "excluded" | "variable" | "name">>) => {
      const { error } = await supabase.from("month_plan_items").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["month_plan", month] }),
  });
}

export function useAddPlanItem(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      item: Pick<MonthPlanItem, "plan_id" | "name" | "kind" | "amount"> &
        Partial<Pick<MonthPlanItem, "due_date" | "variable" | "rule_id">>,
    ) => {
      const user_id = await currentUserId();
      const { error } = await supabase.from("month_plan_items").insert({ ...item, user_id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["month_plan", month] }),
  });
}

export function useDeletePlanItem(month: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("month_plan_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["month_plan", month] }),
  });
}

/** Link (or unlink) a transaction to the plan item it fulfills. */
export function useLinkTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ txnId, planItemId }: { txnId: string; planItemId: string | null }) => {
      const { error } = await supabase
        .from("transactions")
        .update({ plan_item_id: planItemId })
        .eq("id", txnId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["month_plan"] });
    },
  });
}
