import { describe, it, expect } from "vitest";
import { futureValue } from "./investments";

describe("futureValue", () => {
  it("compounds a starting balance at the effective annual rate", () => {
    // $10,000 at an effective 12%/yr for 1 year = exactly $11,200
    const fv = futureValue({ balance: 10000, monthly: 0, annualReturnPct: 12, years: 1 });
    expect(fv).toBeCloseTo(11200, 2);
  });

  it("adds a monthly contribution stream", () => {
    // $0 balance, $100/mo, 0% return, 2 years → exactly 100 * 24
    const fv = futureValue({ balance: 0, monthly: 100, annualReturnPct: 0, years: 2 });
    expect(fv).toBe(2400);
  });

  it("grows contributions with return", () => {
    // $500/mo at an effective 7%/yr for 30y ≈ $585k
    const fv = futureValue({ balance: 0, monthly: 500, annualReturnPct: 7, years: 30 });
    expect(fv).toBeGreaterThan(580000);
    expect(fv).toBeLessThan(590000);
  });

  it("returns the balance itself when years is 0", () => {
    expect(futureValue({ balance: 25000, monthly: 500, annualReturnPct: 7, years: 0 })).toBe(25000);
  });
});
