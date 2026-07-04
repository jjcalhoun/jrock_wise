import type { Transaction, BucketType } from "./types";

/* Detect likely-recurring transactions in the feed: groups of the same
   merchant + account + type that repeat at a regular cadence with a stable
   amount. Surfaced as suggestions the user approves — nothing is auto-created.
   Pure + unit-tested; the UI applies the result. */

export interface RecurringSuggestion {
  signature: string; // stable id: account|type|merchant|frequency
  name: string;
  account_id: string;
  type: "expense" | "income" | "transfer";
  amount: number; // signed, representative (median magnitude)
  category_id: string | null;
  bucket: BucketType | null;
  transfer_account_id: string | null;
  frequency: "monthly" | "biweekly" | "weekly";
  day_of_month: number | null;
  weekday: number | null;
  count: number;
  lastDate: string;
}

export interface DetectOptions {
  minCount?: number; // occurrences required (default 3)
  amountTolPct?: number; // amount spread allowed (default 5)
  dayTol?: number; // cadence tolerance in days (default 3)
}

interface ExistingRule {
  account_id: string;
  type: string;
  name: string;
  active: boolean;
}

const CADENCES = [
  { freq: "weekly" as const, days: 7 },
  { freq: "biweekly" as const, days: 14 },
  { freq: "monthly" as const, days: 30 },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const median = (nums: number[]) => {
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

export function detectRecurring(
  txns: Transaction[],
  existingRules: ExistingRule[] = [],
  dismissed: Set<string> = new Set(),
  opts: DetectOptions = {},
): RecurringSuggestion[] {
  const minCount = opts.minCount ?? 3;
  const amountTolPct = opts.amountTolPct ?? 5;
  const dayTol = opts.dayTol ?? 3;

  const ruleKeys = new Set(
    existingRules.filter((r) => r.active).map((r) => `${r.account_id}|${r.type}|${norm(r.name)}`),
  );

  // Group by account + type + normalized merchant.
  const groups = new Map<string, Transaction[]>();
  for (const t of txns) {
    if (t.source === "recurring" || t.source === "interest") continue; // skip our own
    if (t.type === "refund") continue;
    const merchant = norm(t.merchant || t.description || "");
    if (!merchant) continue;
    const key = `${t.account_id}|${t.type}|${merchant}`;
    const arr = groups.get(key);
    if (arr) arr.push(t);
    else groups.set(key, [t]);
  }

  const out: RecurringSuggestion[] = [];
  for (const [key, list] of groups) {
    if (list.length < minCount || ruleKeys.has(key)) continue;

    const sorted = [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    // Stable amount: every occurrence within tolerance of the median magnitude.
    const mags = sorted.map((t) => Math.abs(t.amount));
    const med = median(mags);
    if (med === 0) continue;
    if (!mags.every((a) => Math.abs(a - med) <= (med * amountTolPct) / 100)) continue;

    // Regular cadence: the median gap matches a known cadence and (nearly) all
    // gaps agree with it.
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1].date, sorted[i].date));
    const gapMed = median(gaps);
    const cad = CADENCES.find((c) => Math.abs(gapMed - c.days) <= dayTol);
    if (!cad) continue;
    const matching = gaps.filter((g) => Math.abs(g - cad.days) <= dayTol).length;
    if (matching < gaps.length - 1) continue; // tolerate at most one irregular gap

    const [account_id, type] = key.split("|");
    const signature = `${key}|${cad.freq}`;
    if (dismissed.has(signature)) continue;

    const last = sorted[sorted.length - 1];
    const d = new Date(`${last.date}T00:00:00Z`);

    const cats = new Set(sorted.map((t) => t.splits?.[0]?.category_id ?? ""));
    const category_id = type === "expense" && cats.size === 1 && [...cats][0] ? [...cats][0] : null;
    const bucket = category_id
      ? (sorted.find((t) => t.splits?.[0])?.splits?.[0]?.bucket ?? null)
      : null;
    const dests = new Set(sorted.map((t) => t.transfer_account_id ?? ""));
    const transfer_account_id =
      type === "transfer" && dests.size === 1 && [...dests][0] ? [...dests][0] : null;

    const amount = type === "expense" ? -med : last.amount < 0 ? -med : med;

    out.push({
      signature,
      name: last.merchant || last.description || "Recurring",
      account_id,
      type: type as RecurringSuggestion["type"],
      amount,
      category_id,
      bucket: bucket as BucketType | null,
      transfer_account_id,
      frequency: cad.freq,
      day_of_month: cad.freq === "monthly" ? d.getUTCDate() : null,
      weekday: cad.freq !== "monthly" ? d.getUTCDay() : null,
      count: sorted.length,
      lastDate: last.date,
    });
  }

  return out.sort((a, b) => b.count - a.count);
}
