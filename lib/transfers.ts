import type { SupabaseClient } from "@supabase/supabase-js";

/* Turning a transaction into a transfer, and making sure the other side exists.
 *
 * A payment into a loan or a card only moves that balance if BOTH legs exist.
 * The bank feed gives you one — the money leaving checking — so the other leg
 * has to come from somewhere:
 *   - if a matching opposite-amount row is already there (both accounts
 *     synced), the two are paired;
 *   - if the destination is MANUAL, the leg is posted, because nothing else
 *     will ever create it;
 *   - if the destination is synced but the row hasn't arrived, nothing is
 *     posted — the feed will bring it, and inventing one would duplicate.
 */

const addDays = (iso: string, n: number) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

const newGroup = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;

export interface ResolveResult {
  /** id of the counterpart leg, whether found or created */
  counterpartId: string | null;
  /** true when the leg had to be posted because the destination is manual */
  createdCounterpart: boolean;
}

export async function resolveTransfer(
  supabase: SupabaseClient,
  id: string,
  transfer_account_id: string,
): Promise<ResolveResult> {
  const { data: txn, error } = await supabase
    .from("transactions")
    .select("id, user_id, account_id, amount, date, description, merchant, transfer_group_id")
    .eq("id", id)
    .single();
  if (error || !txn) throw error ?? new Error("Transaction not found");

  // The counterpart: opposite amount on the other account, near the same date.
  const { data: cands } = await supabase
    .from("transactions")
    .select("id, account_id, amount, date")
    .eq("account_id", transfer_account_id)
    .gte("date", addDays(txn.date, -5))
    .lte("date", addDays(txn.date, 5));
  const counter = (cands ?? [])
    .filter((c) => c.id !== id && Math.abs(Number(c.amount) + Number(txn.amount)) < 0.001)
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.date) - Date.parse(txn.date)) -
        Math.abs(Date.parse(b.date) - Date.parse(txn.date)),
    )[0];

  const group = (txn.transfer_group_id as string | null) ?? newGroup();

  await supabase
    .from("transactions")
    .update({
      type: "transfer",
      reviewed: true,
      transfer_account_id,
      transfer_group_id: group,
      bucket: null,
    })
    .eq("id", id);
  await supabase.from("transaction_splits").delete().eq("transaction_id", id);

  if (counter) {
    await supabase
      .from("transactions")
      .update({
        type: "transfer",
        reviewed: true,
        transfer_account_id: txn.account_id,
        transfer_group_id: group,
        bucket: null,
      })
      .eq("id", counter.id);
    await supabase.from("transaction_splits").delete().eq("transaction_id", counter.id);
    return { counterpartId: counter.id as string, createdCounterpart: false };
  }

  // Synced destinations get their leg from the bank feed; posting one here
  // would duplicate it.
  const { data: maps } = await supabase.from("simplefin_account_map").select("account_id");
  const synced = new Set((maps ?? []).map((m) => m.account_id as string));
  if (synced.has(transfer_account_id)) {
    return { counterpartId: null, createdCounterpart: false };
  }

  const { data: created, error: insErr } = await supabase
    .from("transactions")
    .insert({
      user_id: txn.user_id,
      account_id: transfer_account_id,
      date: txn.date,
      amount: -Number(txn.amount),
      description: txn.description,
      merchant: txn.merchant,
      type: "transfer",
      transfer_account_id: txn.account_id,
      transfer_group_id: group,
      source: "manual",
      reviewed: true,
    })
    .select("id")
    .single();
  if (insErr) throw insErr;
  return { counterpartId: (created?.id as string) ?? null, createdCounterpart: true };
}
