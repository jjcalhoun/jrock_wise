"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type {
  Account,
  Category,
  Transaction,
  BudgetPlan,
  Settings,
  BucketType,
  TransactionType,
} from "@/lib/types";

/**
 * All read/write data hooks for the app, backed by Supabase + TanStack Query.
 * Row Level Security scopes every query to the signed-in user automatically,
 * but inserts still need an explicit user_id (the RLS WITH CHECK requires it).
 */

const supabase = createClient();

async function currentUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */
export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: async (): Promise<Category[]> => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .eq("is_archived", false)
        .order("sort_order");
      if (error) throw error;
      return data as Category[];
    },
  });
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */
export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as Account[];
    },
  });
}

export interface AccountInput {
  name: string;
  type: Account["type"];
  last4?: string | null;
  starting_balance: number;
  as_of_date: string;
  apr?: number;
  color?: string | null;
}

export function useUpsertAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AccountInput & { id?: string }) => {
      const user_id = await currentUserId();
      if (input.id) {
        const { id, ...rest } = input;
        const { error } = await supabase
          .from("accounts")
          .update(rest)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("accounts")
          .insert({ ...input, user_id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Transactions (with splits embedded)                                 */
/* ------------------------------------------------------------------ */
export function useTransactions() {
  return useQuery({
    queryKey: ["transactions"],
    queryFn: async (): Promise<Transaction[]> => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, splits:transaction_splits(*)")
        .order("date", { ascending: false });
      if (error) throw error;
      return data as Transaction[];
    },
  });
}

export interface SplitInput {
  category_id: string;
  bucket: BucketType;
  amount: number;
}

export interface TransactionInput {
  account_id: string;
  date: string;
  amount: number; // signed
  merchant?: string | null;
  type: TransactionType;
  notes?: string | null;
  reviewed?: boolean;
  splits?: SplitInput[]; // expense/refund only
}

export function useAddTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TransactionInput) => {
      const user_id = await currentUserId();
      const { splits, ...txn } = input;
      const { data: created, error } = await supabase
        .from("transactions")
        .insert({ ...txn, user_id, source: "manual" })
        .select()
        .single();
      if (error) throw error;

      if (splits && splits.length > 0) {
        const rows = splits.map((s) => ({
          ...s,
          transaction_id: created.id,
          user_id,
        }));
        const { error: splitErr } = await supabase
          .from("transaction_splits")
          .insert(rows);
        if (splitErr) throw splitErr;
      }
      return created as Transaction;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Budget plan                                                         */
/* ------------------------------------------------------------------ */
export function useBudget() {
  return useQuery({
    queryKey: ["budget"],
    queryFn: async (): Promise<BudgetPlan | null> => {
      const { data, error } = await supabase
        .from("budget_plan")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as BudgetPlan | null;
    },
  });
}

export function useUpdateBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<BudgetPlan>) => {
      const user_id = await currentUserId();
      const { error } = await supabase
        .from("budget_plan")
        .update(input)
        .eq("user_id", user_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget"] });
    },
  });
}

export interface CategoryInput {
  id?: string;
  name: string;
  icon: string;
  color: string;
  bucket: BucketType;
  sort_order?: number;
}

export function useUpsertCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CategoryInput) => {
      const user_id = await currentUserId();
      if (input.id) {
        const { id, ...rest } = input;
        const { error } = await supabase
          .from("categories")
          .update(rest)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("categories")
          .insert({ ...input, user_id });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

/** Archive instead of delete — splits reference categories, so we keep history. */
export function useArchiveCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("categories")
        .update({ is_archived: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Category budgets (per-category monthly targets)                     */
/* ------------------------------------------------------------------ */
export function useCategoryBudgets() {
  return useQuery({
    queryKey: ["category_budgets"],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase
        .from("category_budgets")
        .select("category_id, monthly_target");
      if (error) throw error;
      const out: Record<string, number> = {};
      for (const row of data ?? []) {
        out[row.category_id as string] = Number(row.monthly_target);
      }
      return out;
    },
  });
}

export function useSetCategoryBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { category_id: string; monthly_target: number }) => {
      const user_id = await currentUserId();
      const { error } = await supabase
        .from("category_budgets")
        .upsert(
          { user_id, category_id: input.category_id, monthly_target: input.monthly_target },
          { onConflict: "user_id,category_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["category_budgets"] }),
  });
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async (): Promise<Settings | null> => {
      const { data, error } = await supabase
        .from("settings")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as Settings | null;
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<Settings>) => {
      const user_id = await currentUserId();
      const { error } = await supabase
        .from("settings")
        .update(input)
        .eq("user_id", user_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
