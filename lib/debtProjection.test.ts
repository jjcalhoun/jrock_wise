import { describe, it, expect } from "vitest";
import { projectDebt, type ProjInput } from "./debtProjection";

const base: ProjInput = {
  debts: [
    { id: "cc", name: "Card", balance: 5000, apr: 20, minPayment: 100 },
    { id: "loan", name: "Loan", balance: 10000, apr: 6, minPayment: 150 },
  ],
  strategy: "avalanche",
  monthlySurplus: 800,
  savingsPct: 20,
  investmentsPct: 15,
  startChecking: 2000,
  startSavings: 3000,
  startInvestments: 5000,
  investReturnPct: 7,
  bufferMonths: 12,
};

describe("projectDebt", () => {
  it("pays off all debt and reports a debt-free month", () => {
    const p = projectDebt(base);
    expect(p.debtFreeMonth).toBeGreaterThan(0);
    const last = p.points[p.points.length - 1];
    expect(last.totalDebt).toBeLessThan(0.01);
  });

  it("clears the higher-APR debt first under avalanche", () => {
    const p = projectDebt(base);
    const cc = p.order.find((o) => o.id === "cc")!;
    const loan = p.order.find((o) => o.id === "loan")!;
    expect(cc.monthsToClear).toBeLessThanOrEqual(loan.monthsToClear);
  });

  it("grows savings and investments over time", () => {
    const p = projectDebt(base);
    const last = p.points[p.points.length - 1];
    expect(last.savings).toBeGreaterThan(base.startSavings);
    expect(last.investments).toBeGreaterThan(base.startInvestments);
  });

  it("net worth ends positive and above the start", () => {
    const p = projectDebt(base);
    const first = p.points[0];
    const last = p.points[p.points.length - 1];
    expect(last.netWorth).toBeGreaterThan(first.netWorth);
  });

  it("runs to debt-free + buffer months", () => {
    const p = projectDebt(base);
    expect(p.points[p.points.length - 1].month).toBe(p.debtFreeMonth + 12);
  });

  it("handles no debts (already debt-free)", () => {
    const p = projectDebt({ ...base, debts: [] });
    expect(p.debtFreeMonth).toBe(0);
    expect(p.order).toHaveLength(0);
    expect(p.points.length).toBeGreaterThan(1);
  });
});
