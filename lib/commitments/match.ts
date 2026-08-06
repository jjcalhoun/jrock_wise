import type { Transaction } from "@/lib/types";
import { nameSimilarity } from "./duplicates";
import type { Commitment } from "./types";

/* Ranking candidate commitments for a transaction.
 *
 * This function RANKS AND NEVER ACTS. Nothing links itself — every match is
 * confirmed in review — so there is no confidence threshold to tune and no
 * wrong silent link to discover months later.
 *
 * It also never hides a candidate. Every open commitment in the window comes
 * back, scored; poor matches sort to the bottom rather than disappearing,
 * because "the right option isn't in the list" is the failure this replaces.
 *
 * Weights, strongest first:
 *   account   a card charge cannot settle a checking bill
 *   amount    within tolerance of the planned figure
 *   name      token-based and fuzzy, so NETFLIX.COM matches Netflix
 *   due_hint  tiebreaker ONLY, generous window, never a cutoff
 */

const W_ACCOUNT = 1.0;
const W_DIRECTION = 0.9;
const W_AMOUNT = 0.92;
const W_NAME = 0.58;
const W_DATE = 0.2;
const W_TOTAL = W_ACCOUNT + W_DIRECTION + W_AMOUNT + W_NAME + W_DATE;

/** How generous the date tiebreaker is, in days. Beyond this it simply stops
 *  contributing — it never rules a candidate out. */
const DATE_WINDOW = 14;

export interface Candidate {
  commitment: Commitment;
  /** 0–1 */
  score: number;
  /** transaction already linked to this commitment, if any */
  claimedBy?: Transaction;
}

const days = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;

function accountScore(txn: Transaction, c: Commitment): number {
  if (!c.account_id) return 0.5; // a hand-added line has no account — neutral
  if (txn.account_id === c.account_id) return 1;
  // the far leg of a transfer (payment landing on the card / loan / savings)
  if (c.transfer_account_id && txn.account_id === c.transfer_account_id) return 0.9;
  return 0;
}

function directionScore(txn: Transaction, c: Commitment): number {
  const inflow = txn.amount > 0;
  if (c.kind === "income") return inflow ? 1 : 0;
  if (!inflow) return 1;
  // Positive against an outgoing commitment is only sensible as the receiving
  // leg of a transfer — which is exactly the case the old sign filter hid.
  return c.transfer_account_id && txn.account_id === c.transfer_account_id ? 0.95 : 0.1;
}

function amountScore(txn: Transaction, c: Commitment, tolPct: number): number {
  const planned = Math.abs(c.amount);
  const actual = Math.abs(txn.amount);
  if (planned === 0) return 0;
  const diff = Math.abs(actual - planned);
  if (diff < 0.005) return 1;
  const tol = (planned * tolPct) / 100;
  if (diff >= tol) return 0;
  return 1 - diff / tol;
}

function dateScore(txn: Transaction, c: Commitment): number {
  if (!c.due_hint) return 0.5; // no hint to compare against — stay neutral
  const d = days(txn.date, c.due_hint);
  if (d >= DATE_WINDOW) return 0;
  return 1 - d / DATE_WINDOW;
}

export interface RankOptions {
  /** amount tolerance as a percentage of the planned figure (default 25) */
  amountTolPct?: number;
  /** transactions already linked, used to mark claimed candidates */
  linked?: Transaction[];
}

/** Score every candidate. Sorted best-first; nothing is filtered out. */
export function rankCommitments(
  txn: Transaction,
  commitments: Commitment[],
  opts: RankOptions = {},
): Candidate[] {
  const tolPct = opts.amountTolPct ?? 25;
  const claims = new Map<string, Transaction>();
  for (const t of opts.linked ?? []) {
    if (t.commitment_id && t.id !== txn.id) claims.set(t.commitment_id, t);
  }

  return commitments
    .filter((c) => !c.skipped)
    .map((c) => {
      const score =
        (W_ACCOUNT * accountScore(txn, c) +
          W_DIRECTION * directionScore(txn, c) +
          W_AMOUNT * amountScore(txn, c, tolPct) +
          W_NAME * nameSimilarity(txn.merchant || txn.description || "", c.name) +
          W_DATE * dateScore(txn, c)) /
        W_TOTAL;
      return { commitment: c, score, claimedBy: claims.get(c.id) };
    })
    .sort((a, b) => {
      // an unclaimed candidate outranks a claimed one of equal quality
      const ca = a.claimedBy ? 1 : 0;
      const cb = b.claimedBy ? 1 : 0;
      if (ca !== cb) return ca - cb;
      return b.score - a.score;
    });
}

/** Display order for the picker: chronological, dateless lines last.
 *
 *  Scoring decides what gets PRE-SELECTED and what shows as claimed; it
 *  deliberately does not decide the order. A date-ordered list doubles as a
 *  run-down of what's still coming this month, and repeated occurrences (four
 *  child-support payments, say) get ticked off in the order they happen.
 *  Sorting by score would scramble both. */
export function orderForDisplay(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => {
    const da = a.commitment.due_hint ?? "9999-99-99";
    const db = b.commitment.due_hint ?? "9999-99-99";
    return da.localeCompare(db) || a.commitment.name.localeCompare(b.commitment.name);
  });
}

/** The candidate to pre-select in review. Deliberately conservative: it only
 *  suggests when the match is good AND clearly better than the runner-up, so
 *  an ambiguous pair is left for the user rather than nudged. */
export function suggestCommitment(
  txn: Transaction,
  commitments: Commitment[],
  opts: RankOptions = {},
): Commitment | null {
  const ranked = rankCommitments(txn, commitments, opts).filter((c) => !c.claimedBy);
  if (ranked.length === 0) return null;
  const [best, next] = ranked;
  if (best.score < 0.62) return null;
  if (next && best.score - next.score < 0.05) return null;
  return best.commitment;
}
