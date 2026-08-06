import { describe, it, expect } from "vitest";
import { minPayment, debtPayment } from "./debt";

describe("minPayment", () => {
  it("uses the floor for small balances", () => {
    expect(minPayment(500)).toBe(25); // 2% of 500 = 10, floor 25
  });
  it("uses the percentage for large balances", () => {
    expect(minPayment(5000)).toBe(100); // 2% of 5000
  });
  it("never exceeds the balance", () => {
    expect(minPayment(10)).toBe(10);
  });
});

describe("debtPayment", () => {
  it("uses the actual payment over the minimum — the payoff lever", () => {
    // IUCU CC: $180 minimum, $300 actually paid
    expect(debtPayment({ min_payment: 180, monthly_payment: 300 }, 9324)).toBe(300);
  });

  it("falls back to the minimum, then to the 2% estimate", () => {
    expect(debtPayment({ min_payment: 240 }, 21735)).toBe(240);
    expect(debtPayment({}, 10000)).toBe(minPayment(10000));
  });

  it("takes escrow off the top — it never touches the principal", () => {
    // the real mortgage: $583.57 paid, $230.91 escrow -> $352.66 of P&I
    expect(debtPayment({ monthly_payment: 583.57, escrow_amount: 230.91 }, 75396.96))
      .toBeCloseTo(352.66, 2);
  });

  it("an escrow-inflated payment does not overstate paydown", () => {
    const withEscrow = debtPayment({ monthly_payment: 583.57, escrow_amount: 230.91 }, 75396.96);
    const naive = debtPayment({ monthly_payment: 583.57 }, 75396.96);
    expect(naive - withEscrow).toBeCloseTo(230.91, 2); // the error escrow would cause
  });

  it("never goes negative when escrow swallows the payment", () => {
    expect(debtPayment({ monthly_payment: 100, escrow_amount: 250 }, 5000)).toBe(0);
  });
});
