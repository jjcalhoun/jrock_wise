import { describe, it, expect } from "vitest";
import { planPayoff, minPayment, type DebtInput } from "./debt";

const debts: DebtInput[] = [
  { id: "card", name: "Credit Card", balance: 5000, apr: 22.99 },
  { id: "loan", name: "Student Loan", balance: 20000, apr: 6.8 },
  { id: "small", name: "Store Card", balance: 800, apr: 26.99 },
];

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

describe("planPayoff — strategy ordering", () => {
  it("avalanche orders by highest APR first", () => {
    const plan = planPayoff(debts, 200, "avalanche");
    expect(plan.order.map((d) => d.id)).toEqual(["small", "card", "loan"]);
  });

  it("snowball orders by smallest balance first", () => {
    const plan = planPayoff(debts, 200, "snowball");
    expect(plan.order.map((d) => d.id)).toEqual(["small", "card", "loan"]);
  });

  it("orders differ when balance and APR disagree", () => {
    const d: DebtInput[] = [
      { id: "a", name: "A", balance: 1000, apr: 5 }, // small balance, low APR
      { id: "b", name: "B", balance: 9000, apr: 25 }, // big balance, high APR
    ];
    expect(planPayoff(d, 100, "avalanche").order.map((x) => x.id)).toEqual(["b", "a"]);
    expect(planPayoff(d, 100, "snowball").order.map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("planPayoff — payoff behavior", () => {
  it("returns empty plan when there are no debts", () => {
    const plan = planPayoff([], 100, "avalanche");
    expect(plan.order).toHaveLength(0);
    expect(plan.totalMonths).toBe(0);
  });

  it("clears all debts in finite time and accrues interest", () => {
    const plan = planPayoff(debts, 500, "avalanche");
    expect(plan.totalMonths).toBeGreaterThan(0);
    expect(plan.totalMonths).toBeLessThan(600);
    expect(plan.totalInterest).toBeGreaterThan(0);
    for (const d of plan.order) {
      expect(d.monthsToClear).toBeGreaterThan(0);
      expect(d.monthsToClear).toBeLessThanOrEqual(plan.totalMonths);
    }
  });

  it("more extra payment clears debt faster", () => {
    const slow = planPayoff(debts, 100, "avalanche").totalMonths;
    const fast = planPayoff(debts, 800, "avalanche").totalMonths;
    expect(fast).toBeLessThan(slow);
  });

  it("avalanche pays less total interest than snowball (for this set)", () => {
    const av = planPayoff(debts, 300, "avalanche").totalInterest;
    const sn = planPayoff(debts, 300, "snowball").totalInterest;
    expect(av).toBeLessThanOrEqual(sn);
  });
});
