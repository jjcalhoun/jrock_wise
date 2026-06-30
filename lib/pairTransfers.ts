import type { TransactionType } from "@/lib/types";

/* Pair the two sides of a transfer across accounts so a card/loan payment and
   the matching debit on the funding account both become transfers (excluded
   from spend/income), instead of one side leaking through as an expense and
   double-counting. Pure + tested; the sync applies the result.

   We anchor on a confirmed payment (already classified type="transfer") and
   look for the nearest opposite-amount transaction on a different account within
   a few days. Anchoring on confirmed payments keeps false positives low — two
   unrelated equal expenses never pair, because neither is an anchor. */

export interface PairItem {
  id: string; // external_id (new) or db id (existing)
  accountId: string;
  date: string; // ISO yyyy-mm-dd
  amount: number; // normalized signed
  type: TransactionType;
}

export interface Pair {
  a: PairItem;
  b: PairItem;
}

const daysApart = (d1: string, d2: string) =>
  Math.abs(new Date(`${d1}T00:00:00Z`).getTime() - new Date(`${d2}T00:00:00Z`).getTime()) /
  86400000;

export function pairTransfers(items: PairItem[], windowDays = 5): Pair[] {
  const matched = new Set<string>();
  const pairs: Pair[] = [];

  for (const a of items) {
    if (a.type !== "transfer" || matched.has(a.id)) continue;
    let best: PairItem | null = null;
    let bestDiff = Infinity;
    for (const b of items) {
      if (b.id === a.id || matched.has(b.id)) continue;
      if (b.accountId === a.accountId) continue;
      if (Math.abs(a.amount + b.amount) > 0.001) continue; // opposite magnitudes
      const diff = daysApart(a.date, b.date);
      if (diff > windowDays) continue;
      if (diff < bestDiff) {
        best = b;
        bestDiff = diff;
      }
    }
    if (best) {
      matched.add(a.id);
      matched.add(best.id);
      pairs.push({ a, b: best });
    }
  }

  return pairs;
}
