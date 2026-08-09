import type { Account, Transaction } from "@/lib/types";
import type { Commitment } from "./types";

/* A card you're spending on with nothing planned to pay it.
 *
 * Free-to-spend now counts card purchases as you make them, so the money isn't
 * lost from the month any more. But a card with no payment line is still a hole
 * in the other half of the picture: nothing reserves cash to pay it down, and
 * the debt plan can't see a payment that was never planned. A card can quietly
 * grow while every screen looks fine.
 *
 * This is the same shape as the duplicate-series check: a failure that is
 * silent by construction, so the only way it was ever found was by reading the
 * database and asking why a number felt wrong.
 */

export interface CardGap {
  accountId: string;
  name: string;
  /** spending charged to the card this period */
  spent: number;
  /** what's been paid toward it this period, planned or actual */
  paid: number;
  /** balance owed, when known */
  owed?: number;
}

const monthOf = (iso: string) => iso.slice(0, 7);

/** Cards with spending this period and no card-payment commitment aimed at
 *  them. A card that's dormant — no spending, no balance — is not a gap. */
export function findCardGaps(
  accounts: Pick<Account, "id" | "name" | "type">[],
  commitments: Pick<Commitment, "kind" | "transfer_account_id" | "skipped" | "period">[],
  transactions: Transaction[],
  period: string,
  balances: Record<string, number> = {},
): CardGap[] {
  const cards = accounts.filter((a) => a.type === "credit");
  if (cards.length === 0) return [];

  // Which cards a plan line already aims at. `transfer_account_id` is the card
  // being paid; a cc_payment without one can't be attributed, so it doesn't
  // count as covering anything.
  const planned = new Set(
    commitments
      .filter((c) => c.kind === "cc_payment" && !c.skipped && c.period === period)
      .map((c) => c.transfer_account_id)
      .filter((id): id is string => !!id),
  );

  const out: CardGap[] = [];
  for (const card of cards) {
    if (planned.has(card.id)) continue;

    let spent = 0;
    let paid = 0;
    for (const t of transactions) {
      if (monthOf(t.date) !== period) continue;
      if (t.account_id !== card.id) continue;
      if (t.type === "transfer") {
        // money arriving on the card is a payment toward it
        if (t.amount > 0) paid += t.amount;
        continue;
      }
      for (const s of t.splits ?? []) spent += -s.amount;
    }

    const owed = Math.max(0, -(balances[card.id] ?? 0));
    // Nothing spent and nothing owed means a dormant card, not a gap worth
    // interrupting anyone about.
    if (spent <= 0 && owed <= 0) continue;

    out.push({ accountId: card.id, name: card.name, spent, paid, owed: owed || undefined });
  }
  return out.sort((a, b) => b.spent - a.spent);
}
