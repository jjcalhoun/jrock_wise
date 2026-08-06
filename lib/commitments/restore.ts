import type { Transaction } from "@/lib/types";
import type { Commitment } from "./types";

/* Reconstructing what a payment settles.
 *
 * Settlement is recorded two different ways, and reading only one is what made
 * multi-select look broken: the PRIMARY occurrence is linked from the
 * transaction (`commitment_id`), while any additional ones point back at the
 * transaction (`covered_by`). A reopened editor that only reads the first sees
 * a single selection and silently drops the rest on the next save.
 */

/** Every occurrence this transaction settles, primary first. */
export function selectionFor(
  txn: Pick<Transaction, "id" | "commitment_id">,
  commitments: Pick<Commitment, "id" | "covered_by">[],
): string[] {
  if (!txn.commitment_id) return [];
  const covered = commitments
    .filter((c) => c.covered_by === txn.id && c.id !== txn.commitment_id)
    .map((c) => c.id);
  return [txn.commitment_id, ...covered];
}

export interface Settlement {
  txn: Transaction;
  /** settled as part of a lump that primarily fulfilled another occurrence */
  viaCover: boolean;
}

/** The payment that settled a commitment, however it was recorded. */
export function settlementFor(
  commitment: Pick<Commitment, "id" | "covered_by">,
  transactions: Transaction[],
): Settlement | null {
  if (commitment.covered_by) {
    const t = transactions.find((x) => x.id === commitment.covered_by);
    return t ? { txn: t, viaCover: true } : null;
  }
  const t = transactions.find((x) => x.commitment_id === commitment.id);
  return t ? { txn: t, viaCover: false } : null;
}
