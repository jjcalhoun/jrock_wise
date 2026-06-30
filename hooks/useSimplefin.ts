"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { SimplefinConnection, SimplefinAccountMapping } from "@/lib/types";

const supabase = createClient();

/** One SimpleFIN account returned by /claim, awaiting mapping to our account. */
export interface ClaimedAccount {
  simplefin_account_id: string;
  org_name: string;
  name: string;
  balance: string;
  currency: string;
}

export function useSimplefinConnections() {
  return useQuery({
    queryKey: ["simplefin_connections"],
    queryFn: async (): Promise<SimplefinConnection[]> => {
      const { data, error } = await supabase
        .from("simplefin_connections")
        .select("*")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as SimplefinConnection[];
    },
  });
}

export function useSimplefinMappings() {
  return useQuery({
    queryKey: ["simplefin_mappings"],
    queryFn: async (): Promise<SimplefinAccountMapping[]> => {
      const { data, error } = await supabase.from("simplefin_account_map").select("*");
      if (error) throw error;
      return (data ?? []) as SimplefinAccountMapping[];
    },
  });
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json as T;
}

/** Claim a setup token → returns connectionId + accounts to map. */
export function useClaimSetupToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (setupToken: string) =>
      postJson<{ connectionId: string; accounts: ClaimedAccount[] }>(
        "/api/simplefin/claim",
        { setupToken },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["simplefin_connections"] }),
  });
}

/** List accounts for an already-claimed connection (to map it later). */
export function useConnectionAccounts() {
  return useMutation({
    mutationFn: (connectionId: string) =>
      postJson<{ connectionId: string; accounts: ClaimedAccount[] }>(
        "/api/simplefin/accounts",
        { connectionId },
      ),
  });
}

export interface MappingInput {
  simplefin_account_id: string;
  account_id: string;
  org_name?: string;
}

export function useMapAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { connectionId: string; mappings: MappingInput[] }) =>
      postJson<{ mapped: number }>("/api/simplefin/map", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["simplefin_mappings"] }),
  });
}

export function useSyncSimplefin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (connectionId?: string) =>
      postJson<{ inserted: number; balancesUpdated: number; errors: string[] }>(
        "/api/simplefin/sync",
        connectionId ? { connectionId } : {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["account_balances"] });
      qc.invalidateQueries({ queryKey: ["simplefin_connections"] });
    },
  });
}

/** Remove a connection (cascades its account mappings). Live balances on the
    accounts are cleared so they revert to computed balances. */
export function useDisconnectSimplefin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (connectionId: string) => {
      // Clear live balances on accounts mapped to this connection first.
      const { data: maps } = await supabase
        .from("simplefin_account_map")
        .select("account_id")
        .eq("connection_id", connectionId);
      const ids = (maps ?? []).map((m) => m.account_id as string);
      if (ids.length > 0) {
        await supabase
          .from("accounts")
          .update({ live_balance: null, live_balance_at: null })
          .in("id", ids);
      }
      const { error } = await supabase
        .from("simplefin_connections")
        .delete()
        .eq("id", connectionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["simplefin_connections"] });
      qc.invalidateQueries({ queryKey: ["simplefin_mappings"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["account_balances"] });
    },
  });
}
