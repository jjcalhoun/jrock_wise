import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTransfer } from "@/lib/transfers";
import type { Commitment } from "./types";

/* Confirming that a manual-account commitment actually happened.
 *
 * This is what generation used to do on a schedule, moved to the moment you
 * say so. It builds the same shape a generated row had — the category split
 * for a categorized bill, the counterpart leg for a transfer — and links it to
 * the commitment, so the plan reads paid and the balances move.
 *
 * The amount is a parameter rather than the planned figure, because the whole
 * reason to ask is that the app doesn't know: a variable bill lands differently
 * every month, and a payment can be more than planned.
 */

export interface ConfirmResult {
  transactionId: string;
}

export async function confirmCommitment(
  supabase: SupabaseClient,
  commitment: Commitment,
  actualAmount: number,
  onDate: string,
): Promise<ConfirmResult> {
  if (!commitment.account_id) {
    throw new Error("This line has no account, so there is nothing to post to.");
  }

  const isTransfer = !!commitment.transfer_account_id;
  const signed = commitment.kind === "income" ? Math.abs(actualAmount) : -Math.abs(actualAmount);

  const { data: created, error } = await supabase
    .from("transactions")
    .insert({
      user_id: commitment.user_id,
      account_id: commitment.account_id,
      date: onDate,
      amount: signed,
      description: commitment.name,
      merchant: commitment.name,
      type: isTransfer ? "transfer" : commitment.kind === "income" ? "income" : "expense",
      transfer_account_id: commitment.transfer_account_id ?? null,
      source: "manual",
      reviewed: true,
      commitment_id: commitment.id,
    })
    .select("id")
    .single();
  if (error || !created) throw error ?? new Error("Could not record the payment");
  const txnId = created.id as string;

  // A categorized bill needs its split, or it never reaches the category
  // rollup — the same rule generation followed.
  if (!isTransfer && commitment.category_id && commitment.bucket) {
    const { error: splitErr } = await supabase.from("transaction_splits").insert({
      user_id: commitment.user_id,
      transaction_id: txnId,
      category_id: commitment.category_id,
      bucket: commitment.bucket,
      amount: signed,
    });
    if (splitErr) throw splitErr;
  }

  // A transfer needs its far leg, or the destination balance never moves.
  if (isTransfer && commitment.transfer_account_id) {
    await resolveTransfer(supabase, txnId, commitment.transfer_account_id);
  }

  return { transactionId: txnId };
}

/** Undo a confirmation: remove the transaction it created (and its far leg).
 *  Only ever touches rows this app posted — a real bank transaction that
 *  happens to be linked is left alone. */
export async function unconfirmCommitment(
  supabase: SupabaseClient,
  commitmentId: string,
): Promise<{ removed: number }> {
  const { data: rows } = await supabase
    .from("transactions")
    .select("id, source, transfer_group_id")
    .eq("commitment_id", commitmentId);

  const mine = (rows ?? []).filter((r) => r.source === "manual");
  if (mine.length === 0) return { removed: 0 };

  const groups = mine.map((r) => r.transfer_group_id).filter(Boolean) as string[];
  const ids = mine.map((r) => r.id as string);

  // take the far legs with it, so a half-transfer isn't left behind
  if (groups.length > 0) {
    const { data: legs } = await supabase
      .from("transactions")
      .select("id")
      .in("transfer_group_id", groups);
    for (const l of legs ?? []) if (!ids.includes(l.id as string)) ids.push(l.id as string);
  }

  const { error } = await supabase.from("transactions").delete().in("id", ids);
  if (error) throw error;
  return { removed: ids.length };
}
