/**
 * Debt helpers shared by the Debt planner.
 *
 * Schema has no per-account minimum payment by default, so we estimate one as
 * max($25, 2% of the balance) — a common credit-card convention — when a debt
 * has no explicit minimum set.
 */

export type DebtStrategy = "avalanche" | "snowball";

const MIN_FLOOR = 25;
const MIN_RATE = 0.02;

export function minPayment(balance: number): number {
  return Math.min(balance, Math.max(MIN_FLOOR, balance * MIN_RATE));
}
