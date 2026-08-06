import type { SupabaseClient } from "@supabase/supabase-js";

/* Linking a transaction to the commitment it fulfills.
 *
 * Commitments are single-occupancy: one planned payment, one real payment. So
 * taking a commitment that something else already holds RELEASES the previous
 * holder and pushes it back into review — correcting one mistake surfaces the
 * other rather than silently orphaning it. That's what makes the dimmed
 * "Claimed" chips safe to tap.
 *
 * The exception is a two-sided transfer: both legs legitimately share one
 * commitment, and the ledger already counts the pair once (it prefers the
 * outflow leg). Legs of the same transfer never evict each other.
 */

export interface LinkResult {
  /** transactions unlinked and returned to review */
  released: string[];
}

export async function linkTransactionToCommitment(
  supabase: SupabaseClient,
  txnId: string,
  commitmentId: string | null,
): Promise<LinkResult> {
  const released: string[] = [];

  if (commitmentId) {
    const [{ data: holders }, { data: me }] = await Promise.all([
      supabase.from("transactions").select("id, transfer_group_id").eq("commitment_id", commitmentId),
      supabase.from("transactions").select("transfer_group_id").eq("id", txnId).maybeSingle(),
    ]);
    const myGroup = (me?.transfer_group_id as string | null) ?? null;

    for (const h of holders ?? []) {
      if (h.id === txnId) continue;
      if (myGroup && h.transfer_group_id === myGroup) continue; // same transfer
      released.push(h.id as string);
    }

    if (released.length > 0) {
      const { error } = await supabase
        .from("transactions")
        .update({ commitment_id: null, reviewed: false })
        .in("id", released);
      if (error) throw error;
    }
  }

  const { error } = await supabase
    .from("transactions")
    .update({ commitment_id: commitmentId })
    .eq("id", txnId);
  if (error) throw error;

  return { released };
}
