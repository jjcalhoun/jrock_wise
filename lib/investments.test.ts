import { describe, it, expect } from "vitest";
import { futureValue } from "./investments";

describe("futureValue", () => {
  it("compounds a starting balance with no contributions", () => {
    // $10,000 at 12%/yr (1%/mo) for 1 year ≈ 10000 * 1.01^12
    const fv = futureValue({ balance: 10000, monthly: 0, annualReturnPct: 12, years: 1 });
    expect(fv).toBeCloseTo(10000 * Math.pow(1.01, 12), 2);
  });

  it("adds a monthly contribution stream", () => {
    // $0 balance, $100/mo, 0% return, 2 years → exactly 100 * 24
    const fv = futureValue({ balance: 0, monthly: 100, annualReturnPct: 0, years: 2 });
    expect(fv).toBe(2400);
  });

  it("grows contributions with return", () => {
    // $500/mo at 7% (annual/12 monthly compounding) for 30y ≈ $610k
    const fv = futureValue({ balance: 0, monthly: 500, annualReturnPct: 7, years: 30 });
    expect(fv).toBeGreaterThan(605000);
    expect(fv).toBeLessThan(615000);
  });

  it("returns the balance itself when years is 0", () => {
    expect(futureValue({ balance: 25000, monthly: 500, annualReturnPct: 7, years: 0 })).toBe(25000);
  });
});
