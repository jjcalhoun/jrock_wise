/** Compound-growth projection for the investment / retirement calculator. */

export interface FutureValueInput {
  balance: number; // current invested balance
  monthly: number; // total monthly contribution (yours + employer match)
  annualReturnPct: number; // expected annual return, e.g. 7
  years: number; // years until retirement
}

/** Future value of a starting balance plus a monthly contribution stream.
 *  Uses the EFFECTIVE annual rate: the monthly rate is chosen so that 12 months
 *  compound to exactly annualReturnPct per year (e.g. "7%" means 7.00%/yr, not a
 *  nominal 7%/12 that would compound to ~7.23%). */
export function futureValue({ balance, monthly, annualReturnPct, years }: FutureValueInput): number {
  const n = Math.max(0, Math.round(years * 12));
  const r = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
  const fvBalance = balance * Math.pow(1 + r, n);
  const fvContrib = r > 0 ? monthly * ((Math.pow(1 + r, n) - 1) / r) : monthly * n;
  return fvBalance + fvContrib;
}
