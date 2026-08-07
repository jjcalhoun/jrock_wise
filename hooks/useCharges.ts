"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

/* Post the charges a liability account accrues on its own — interest, and
   escrow on a mortgage. Nothing else writes a transaction because a date
   passed. */
export function usePostCharges() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<{ inserted: number; errors: string[] }> => {
      const res = await fetch("/api/charges/post", { method: "POST" });
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
