import { describe, it, expect } from "vitest";
import { classifyTxn } from "./classifyTxn";

describe("classifyTxn", () => {
  it("credit-card interest → auto-reviewed Fees expense (not income)", () => {
    const c = classifyTxn({
      amount: 12.5, // arrives positive on an amount-owed card
      description: "INTEREST CHARGE ON PURCHASES",
      accountType: "credit",
      accountBalance: 634.6,
    });
    expect(c.type).toBe("expense");
    expect(c.interest).toBe(true);
    expect(c.autoReview).toBe(true);
    expect(c.normalizedAmount).toBe(-12.5);
  });

  it("credit-card payment → auto-reviewed transfer", () => {
    const c = classifyTxn({
      amount: -200,
      description: "AUTOPAY THANK YOU - PAYMENT",
      accountType: "credit",
      accountBalance: 634.6,
    });
    expect(c.type).toBe("transfer");
    expect(c.autoReview).toBe(true);
  });

  it("the matching checking debit for a payment → transfer too", () => {
    const c = classifyTxn({
      amount: -200,
      description: "Online Payment to Card",
      accountType: "checking",
      accountBalance: 4.66,
    });
    expect(c.type).toBe("transfer");
    expect(c.autoReview).toBe(true);
  });

  it("credit-card purchase (amount-owed convention) → expense for Review", () => {
    const c = classifyTxn({
      amount: 45.99,
      description: "AMAZON MARKETPLACE",
      accountType: "credit",
      accountBalance: 634.6,
    });
    expect(c.type).toBe("expense");
    expect(c.autoReview).toBe(false);
    expect(c.normalizedAmount).toBe(-45.99);
  });

  it("credit-card credit/return (reduces debt, not a payment) → refund", () => {
    const c = classifyTxn({
      amount: -30,
      description: "MERCHANT REFUND",
      accountType: "credit",
      accountBalance: 634.6,
    });
    expect(c.type).toBe("refund");
    expect(c.normalizedAmount).toBe(30);
  });

  it("respects the opposite sign convention (negative-balance card)", () => {
    const charge = classifyTxn({
      amount: -45,
      description: "STORE",
      accountType: "credit",
      accountBalance: -634.6, // balance reported negative when owed
    });
    expect(charge.type).toBe("expense");
  });

  it("checking purchase → expense, deposit → income", () => {
    expect(classifyTxn({ amount: -20, description: "Coffee", accountType: "checking", accountBalance: 100 }).type).toBe("expense");
    expect(classifyTxn({ amount: 500, description: "Paycheck", accountType: "checking", accountBalance: 100 }).type).toBe("income");
  });
});
