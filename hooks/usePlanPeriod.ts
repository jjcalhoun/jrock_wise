"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/* "Have you looked at this month yet?" — and nothing else.
 *
 * `month_plans` used to own a month's expectations through `month_plan_items`.
 * Commitments own those now, and once they did the plan table was left holding
 * a single timestamp. This is that timestamp, on a table that admits it: it
 * decides whether the plan sheet opens itself when you launch the app.
 */

const supabase = createClient();

export interface PlanPeriod {
  id: string;
  period: string;
  confirmed_at: string | null;
}

export function usePlanPeriod(period: string) {
  return useQuery({
    queryKey: ["plan_period", period],
    queryFn: async (): Promise<PlanPeriod | null> => {
      const { data, error } = await supabase
        .from("plan_periods")
        .select("id, period, confirmed_at")
        .eq("period", period)
        .maybeSingle();
      if (error) throw error;
      return (data as PlanPeriod) ?? null;
    },
    enabled: !!period,
  });
}

/** Mark the period reviewed. Idempotent — confirming twice is confirming. */
export function useConfirmPeriod(period: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase.from("plan_periods").upsert(
        {
          user_id: user.id,
          period,
          confirmed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,period" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan_period", period] }),
  });
}
