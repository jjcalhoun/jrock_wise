/* Suspected-duplicate detection across series.
 *
 * The twins in the data come from identity being a merchant string: detection
 * only skips a suggestion when `account|type|normalized-name` matches an
 * existing rule, so "Netflix", "NETFLIX.COM" and "Netflix Inc" each became
 * their own bill — landing a day or two apart because each took its day from
 * whichever transaction spawned it.
 *
 * This groups series that are probably the same real-world commitment. It only
 * ever REPORTS: merging is the user's call, never automatic. Pure + tested;
 * phase 1 runs it as a report, phase 3 reuses it for the "Merge these" prompt.
 */

export interface SeriesLike {
  /** series_id (or, pre-migration, the rule id) */
  id: string;
  name: string;
  account_id: string | null;
  amount: number; // signed
  frequency: string;
  /** false for paused/ended series — they can't be live duplicates */
  live: boolean;
}

export interface DuplicateGroup {
  members: SeriesLike[];
  /** 0–1 confidence that these are the same commitment */
  score: number;
  reasons: string[];
}

export interface DuplicateOptions {
  /** relative amount spread allowed between members (default 15%) */
  amountTolPct?: number;
  /** minimum name similarity to consider a pair (default 0.5) */
  minNameScore?: number;
  /** minimum combined score to report a group (default 0.6) */
  minScore?: number;
}

/* Tokens that carry no identity — payment rails, corporate suffixes, and the
   words a bank feed sprinkles through a descriptor. */
const NOISE = new Set([
  "com", "inc", "llc", "ltd", "co", "corp", "company", "the",
  "payment", "payments", "pmt", "autopay", "auto", "recurring", "bill", "billpay",
  "ach", "pos", "debit", "credit", "purchase", "web", "online", "id", "ref",
  "transfer", "xfer", "monthly", "subscription", "sub",
]);

/** Identity tokens for a merchant/commitment name: case, punctuation, store
 *  numbers and rail noise all stripped. */
export function nameTokens(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => {
      if (!t || t.length < 2) return false;
      if (NOISE.has(t)) return false;
      if (/^\d+$/.test(t)) return false; // store / invoice numbers
      if (/^x?\d+$/.test(t)) return false; // x1234
      return true;
    });
}

/** 0–1 similarity between two names. Jaccard, plus a containment term so
 *  "netflix" still scores against "netflix com subscription". */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  const jaccard = union === 0 ? 0 : shared / union;
  const containment = shared / Math.min(ta.size, tb.size);
  return Math.max(jaccard, containment * 0.95);
}

const relDiff = (a: number, b: number) => {
  const x = Math.abs(a);
  const y = Math.abs(b);
  const base = Math.min(x, y);
  if (base === 0) return x === y ? 0 : Infinity;
  return Math.abs(x - y) / base;
};

/** Union-find over indices. */
function unite(n: number, pairs: [number, number][]): number[][] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of pairs) parent[find(a)] = find(b);
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

export function findDuplicateSeries(
  series: SeriesLike[],
  opts: DuplicateOptions = {},
): DuplicateGroup[] {
  const amountTol = (opts.amountTolPct ?? 15) / 100;
  const minNameScore = opts.minNameScore ?? 0.5;
  const minScore = opts.minScore ?? 0.6;

  const live = series.filter((s) => s.live);
  const pairs: [number, number][] = [];
  const pairScore = new Map<string, { score: number; name: number; amt: number }>();

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      // A duplicate has to be the same account and the same direction of money.
      if (a.account_id !== b.account_id) continue;
      if (Math.sign(a.amount) !== Math.sign(b.amount)) continue;

      const nameScore = nameSimilarity(a.name, b.name);
      if (nameScore < minNameScore) continue;

      const diff = relDiff(a.amount, b.amount);
      if (!(diff <= amountTol)) continue;
      const amtScore = 1 - diff / amountTol;

      const score = 0.65 * nameScore + 0.35 * amtScore;
      if (score < minScore) continue;

      pairs.push([i, j]);
      pairScore.set(`${i}|${j}`, { score, name: nameScore, amt: amtScore });
    }
  }

  return unite(live.length, pairs)
    .map((idxs) => {
      const members = idxs.map((i) => live[i]);
      // A group's confidence is its weakest link.
      let score = 1;
      let minName = 1;
      let minAmt = 1;
      for (let x = 0; x < idxs.length; x++) {
        for (let y = x + 1; y < idxs.length; y++) {
          const s = pairScore.get(`${Math.min(idxs[x], idxs[y])}|${Math.max(idxs[x], idxs[y])}`);
          if (!s) continue;
          score = Math.min(score, s.score);
          minName = Math.min(minName, s.name);
          minAmt = Math.min(minAmt, s.amt);
        }
      }
      const reasons: string[] = [];
      if (minName >= 0.95) reasons.push("same name");
      else reasons.push("similar names");
      if (minAmt >= 0.95) reasons.push("same amount");
      else reasons.push("amounts within tolerance");
      const freqs = new Set(members.map((m) => m.frequency));
      reasons.push(freqs.size === 1 ? `both ${[...freqs][0]}` : `different cadences (${[...freqs].join(", ")})`);
      return { members, score: Math.round(score * 100) / 100, reasons };
    })
    .sort((a, b) => b.score - a.score);
}
