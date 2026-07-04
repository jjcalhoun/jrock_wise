import type { Transaction, RecurringRule, BucketType } from "./types";
import { occurrences } from "./recurring";
import { monthKey } from "./aggregations";

/* Predict-then-fill for the CURRENT month.
 *
 * A recurring rule promises N occurrences this month. Some have already
 * landed (a real synced charge, or a pre-posted manual/recurring row) and are
 * counted by rollup(). The rest haven't happened yet — we surface them as a
 * *prediction* so the month reflects what's still coming (an upcoming bill, the
 * next paycheck) without waiting for the transaction to post.
 *
 * As each real item lands it "fills" one promised occurrence, so the predicted
 * remainder shrinks and nothing is ever double-counted:
 *     predicted occurrences = max(0, scheduled this month − already realized)
 *
 * Pure + unit-tested; callers add these amounts on top of the actual rollup for
 * the current month only. Past months are always actual.
 */

export interface Prediction {
  income: number; // predicted income still to come this month
  spend: number; // predicted spend still to come this month
  byBucket: Record<BucketType, number>;
  byCat: Record<string, number>;
  count: number; // number of predicted occurrences (for a UI hint)
}

const empty = (): Prediction => ({
  income: 0,
  spend: 0,
  byBucket: { needs: 0, wants: 0, savings: 0 },
  byCat: {},
  count: 0,
});

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

/** Does this real transaction realize an occurrence of `rule`? */
function realizes(t: Transaction, rule: RecurringRule, tolPct: number): boolean {
  if (t.account_id !== rule.account_id || t.type !== rule.type) return false;
  // Rows we generated for this exact rule always count.
  if (t.external_id?.startsWith(`recurring:${rule.id}:`)) return true;

  const amtOk =
    Math.abs(Math.abs(t.amount) - Math.abs(rule.amount)) <=
    (Math.abs(rule.amount) * tolPct) / 100;
  if (!amtOk) return false;

  // Income is matched on account + amount alone (the paycheck merchant name
  // rarely matches the rule name). Expenses also require a merchant match so
  // unrelated charges on the same account don't fill the wrong bill.
  if (rule.type === "income") return true;
  const m = norm(t.merchant || t.description || "");
  const r = norm(rule.name);
  return !!m && !!r && (m === r || m.includes(r) || r.includes(m));
}

export function predictMonth(
  rules: RecurringRule[],
  txns: Transaction[],
  month: string, // "YYYY-MM"
  opts: { amountTolPct?: number } = {},
): Prediction {
  const tolPct = opts.amountTolPct ?? 15;
  const out = empty();

  const monthStart = `${month}-01`;
  const monthEnd = lastDayOfMonth(month);
  const monthTxns = txns.filter((t) => monthKey(t.date) === month);

  for (const rule of rules) {
    if (!rule.active) continue;
    if (rule.type !== "expense" && rule.type !== "income") continue;

    const scheduled = occurrences(rule, monthStart, monthEnd).length;
    if (scheduled === 0) continue;

    const realized = monthTxns.filter((t) => realizes(t, rule, tolPct)).length;
    const remaining = Math.max(0, scheduled - realized);
    if (remaining === 0) continue;

    const mag = Math.abs(rule.amount);
    out.count += remaining;

    if (rule.type === "income") {
      out.income += remaining * mag;
    } else {
      const contrib = remaining * mag;
      out.spend += contrib;
      const bucket: BucketType = rule.bucket ?? "wants";
      out.byBucket[bucket] += contrib;
      if (rule.category_id) {
        out.byCat[rule.category_id] = (out.byCat[rule.category_id] ?? 0) + contrib;
      }
    }
  }

  return out;
}
