/** Compound-growth projection for the investment / retirement calculator. */

export interface FutureValueInput {
  balance: number; // current invested balance
  monthly: number; // total monthly contribution (yours + employer match)
  annualReturnPct: number; // expected annual return, e.g. 7
  years: number; // years until retirement
}

/** Future value of a starting balance plus a monthly contribution stream,
 *  compounded monthly. */
export function futureValue({ balance, monthly, annualReturnPct, years }: FutureValueInput): number {
  const n = Math.max(0, Math.round(years * 12));
  const r = annualReturnPct / 100 / 12;
  const fvBalance = balance * Math.pow(1 + r, n);
  const fvContrib = r > 0 ? monthly * ((Math.pow(1 + r, n) - 1) / r) : monthly * n;
  return fvBalance + fvContrib;
}
