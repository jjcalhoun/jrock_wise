/* Period helpers. A period is "YYYY-MM" — the unit a commitment belongs to.
 *
 * Matching draws from a WINDOW of periods rather than the transaction's own
 * calendar month, because the due date is a hint: a bill due the 31st can clear
 * on the 1st, and a paycheck for one month can land in the next. Locking the
 * picker to the transaction's month is what made the correct option invisible.
 */

export function addPeriod(period: string, delta: number): string {
  const [y, m] = period.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** The period a date falls in, before any commitment is considered. */
export const periodOf = (date: string): string => date.slice(0, 7);

/** Periods a transaction may reasonably fulfill: its own, plus either side. */
export function periodWindow(period: string, radius = 1): string[] {
  const out: string[] = [];
  for (let d = -radius; d <= radius; d++) out.push(addPeriod(period, d));
  return out;
}
