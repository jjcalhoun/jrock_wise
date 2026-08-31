import type { Transaction } from "@/lib/types";
import type { Commitment } from "./types";

/* A payment settling the wrong occurrence of its own series.
 *
 * A July 31st paycheck was linked to the AUGUST 31st plan line. Because a
 * linked payment counts toward its COMMITMENT's month rather than its own
 * date — deliberate, so a bill due the 31st that clears on the 1st lands in
 * the month that expected it — that single mis-pick moved a whole paycheck
 * between months. August read $1,927 it never received; July went short by the
 * same amount. Nothing anywhere said so.
 *
 * THE RULE IS NOT "outside its month". That would have missed this entirely:
 * July 31st is one day outside August, indistinguishable from the legitimate
 * case the flexibility exists for.
 *
 * What gives it away is the SIBLING. If the same series has another occurrence
 * far nearer this payment's date than the one it's linked to, the link is
 * almost certainly a mis-tap between two chips that read alike — `ADP · 7/31`
 * and `ADP · 8/31`. One day out with no better sibling is fine; a month out
 * when its twin sits on the exact date is not.
 */

export interface MisdatedLink {
  txn: Transaction;
  /** the occurrence it is currently linked to */
  linkedTo: Commitment;
  /** the occurrence of the same series that fits its date far better */
  better: Commitment;
  /** days between the payment and the line it's linked to */
  gap: number;
  /** days between the payment and the better fit */
  betterGap: number;
}

const days = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;

const dateOf = (c: Commitment) => c.due_hint ?? `${c.period}-15`;

export interface MisdatedOptions {
  /** how far from its line a payment must be before it's worth questioning */
  minGap?: number;
  /** how much nearer the sibling has to be to call it a mis-pick */
  minImprovement?: number;
}

/** Links where another occurrence of the same series fits the date far better.
 *
 *  Both thresholds default to 10 days, which clears the legitimate cases by a
 *  wide margin: a payment a day or two either side of its line is never
 *  questioned, however its month falls. */
export function findMisdatedLinks(
  commitments: Commitment[],
  transactions: Transaction[],
  opts: MisdatedOptions = {},
): MisdatedLink[] {
  const minGap = opts.minGap ?? 10;
  const minImprovement = opts.minImprovement ?? 10;

  const byId = new Map(commitments.map((c) => [c.id, c]));
  const bySeries = new Map<string, Commitment[]>();
  for (const c of commitments) {
    const arr = bySeries.get(c.series_id);
    if (arr) arr.push(c);
    else bySeries.set(c.series_id, [c]);
  }

  // Lines already settled by something else can't be the better home.
  const held = new Set<string>();
  for (const t of transactions) if (t.commitment_id) held.add(t.commitment_id);
  for (const c of commitments) if (c.covered_by) held.add(c.id);

  const out: MisdatedLink[] = [];
  for (const t of transactions) {
    if (!t.commitment_id) continue;
    const linkedTo = byId.get(t.commitment_id);
    if (!linkedTo) continue;

    const gap = days(t.date, dateOf(linkedTo));
    if (gap < minGap) continue;

    let better: Commitment | null = null;
    let betterGap = gap;
    for (const sib of bySeries.get(linkedTo.series_id) ?? []) {
      if (sib.id === linkedTo.id) continue;
      if (sib.skipped || held.has(sib.id)) continue;
      const g = days(t.date, dateOf(sib));
      if (g < betterGap) {
        better = sib;
        betterGap = g;
      }
    }

    if (better && gap - betterGap >= minImprovement) {
      out.push({ txn: t, linkedTo, better, gap, betterGap });
    }
  }

  return out.sort((a, b) => b.gap - a.gap);
}
