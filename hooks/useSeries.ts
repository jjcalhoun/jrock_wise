"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Commitment } from "@/lib/commitments/types";
import {
  planSeriesEdit,
  scheduleFields,
  seriesDrafts,
  seriesFrom,
  signedAmount,
  type SeriesInput,
} from "@/lib/commitments/series";

/* Recurring series, stored as commitments and nothing else.
 *
 * This replaces useRecurring, which kept a parallel `recurring_rules` row for
 * every series and had to push each edit onto the commitments by hand. Half the
 * bugs in that file were the two copies disagreeing. There is one copy now, so
 * saving a series is a write to `commitments` and the plan is already correct.
 */

const supabase = createClient();

async function currentUserId(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  return user.id;
}

/** The live series — one row each, the most recent occurrence, which carries
 *  the schedule and therefore IS the rule. */
export function useSeries() {
  return useQuery({
    queryKey: ["series"],
    queryFn: async (): Promise<Commitment[]> => {
      const { data, error } = await supabase.from("commitments").select("*");
      if (error) throw error;
      return seriesFrom((data ?? []) as Commitment[]);
    },
  });
}

export interface UpsertSeriesArgs {
  /** omit to create a new series */
  seriesId?: string;
  period: string;
  input: SeriesInput;
  /** the transaction this series was created from ("repeat this") — it gets
   *  linked to its nearest occurrence so the month doesn't count it twice */
  sourceTxn?: { id: string; date: string };
}

export function useUpsertSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ seriesId, period, input, sourceTxn }: UpsertSeriesArgs) => {
      const user_id = await currentUserId();

      // ---- new series: just its occurrences for this period ----
      if (!seriesId) {
        const id = crypto.randomUUID();
        const drafts = seriesDrafts(input, id, period).map((d) => ({
          ...d,
          user_id,
          series_ended: input.ended ?? false,
        }));
        const { data: made, error } = await supabase
          .from("commitments")
          .insert(drafts)
          .select("id, due_hint");
        if (error) throw error;
        if (sourceTxn && made && made.length > 0) await link(sourceTxn, made);
        return id;
      }

      // ---- existing series: rebuild this period, keeping what's paid ----
      const [{ data: rows }, { data: links }] = await Promise.all([
        supabase.from("commitments").select("*").eq("series_id", seriesId),
        supabase.from("transactions").select("commitment_id").not("commitment_id", "is", null),
      ]);
      const all = (rows ?? []) as Commitment[];
      const linked = new Set((links ?? []).map((t) => t.commitment_id as string));
      const isSettled = (c: Commitment) => linked.has(c.id) || !!c.covered_by;

      const plan = planSeriesEdit(input, seriesId, period, all, isSettled);
      const sched = scheduleFields(input);

      if (plan.remove.length > 0) {
        const { error } = await supabase.from("commitments").delete().in("id", plan.remove);
        if (error) throw error;
      }
      if (plan.insert.length > 0) {
        const { error } = await supabase
          .from("commitments")
          .insert(plan.insert.map((d) => ({ ...d, user_id, series_ended: sched.series_ended })));
        if (error) throw error;
      }
      // A settled row keeps its name and amount — that's history — but must
      // learn the new schedule, or clone-forward would carry the old one.
      if (plan.restamp.length > 0) {
        const { error } = await supabase
          .from("commitments")
          .update({ ...sched, updated_at: new Date().toISOString() })
          .in("id", plan.restamp);
        if (error) throw error;
      }
      // Ending applies to the whole series, past periods included, so nothing
      // is left behind to clone from.
      const { error: sErr } = await supabase
        .from("commitments")
        .update({ series_ended: sched.series_ended, updated_at: new Date().toISOString() })
        .eq("series_id", seriesId);
      if (sErr) throw sErr;

      return seriesId;
    },
    onSuccess: () => invalidate(qc),
  });
}

async function link(
  sourceTxn: { id: string; date: string },
  made: { id: string; due_hint: string | null }[],
) {
  const nearest = [...made].sort((a, b) => dist(a, sourceTxn.date) - dist(b, sourceTxn.date))[0];
  await supabase
    .from("transactions")
    .update({ commitment_id: nearest.id })
    .eq("id", sourceTxn.id)
    .is("commitment_id", null);
}

const dist = (c: { due_hint: string | null }, date: string) =>
  c.due_hint ? Math.abs(Date.parse(c.due_hint) - Date.parse(date)) : Infinity;

/** Delete a series outright. Only for one that never had a payment — normally
 *  you END a series, which keeps its history and stops the future. */
export function useDeleteSeries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (seriesId: string) => {
      const { data: rows } = await supabase
        .from("commitments")
        .select("id")
        .eq("series_id", seriesId);
      const ids = (rows ?? []).map((r) => r.id as string);
      if (ids.length === 0) return;

      // Anything a payment touched is ended rather than erased: deleting it
      // would strand a real transaction with a dangling link.
      const { data: links } = await supabase
        .from("transactions")
        .select("commitment_id")
        .in("commitment_id", ids);
      if ((links ?? []).length > 0) {
        const { error } = await supabase
          .from("commitments")
          .update({ series_ended: true, updated_at: new Date().toISOString() })
          .eq("series_id", seriesId);
        if (error) throw error;
        return;
      }
      const { error } = await supabase.from("commitments").delete().eq("series_id", seriesId);
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["series"] });
  qc.invalidateQueries({ queryKey: ["commitments"] });
  qc.invalidateQueries({ queryKey: ["commitments_window"] });
  qc.invalidateQueries({ queryKey: ["transactions"] });
}

export { signedAmount };

/* ---- detection suggestions the user has waved off ---- */

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
