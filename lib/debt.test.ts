import { describe, it, expect } from "vitest";
import { minPayment } from "./debt";

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
