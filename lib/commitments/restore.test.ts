import { describe, it, expect } from "vitest";
import { selectionFor, settlementFor } from "./restore";
import type { Transaction } from "@/lib/types";
import type { Commitment } from "./types";

const c = (id: string, covered_by: string | null = null) =>
  ({ id, covered_by }) as Pick<Commitment, "id" | "covered_by">;
const t = (over: Partial<Transaction> & { id: string }) =>
  ({ merchant: null, description: null, amount: -206, ...over }) as Transaction;

describe("selectionFor", () => {
  it("restores the primary AND everything it covers", () => {
    // the real case: a 7/31 payment covering 7/31 and 8/7
    const sel = selectionFor(t({ id: "ZELLE", commitment_id: "jul31" }), [
      c("jul31"),
      c("aug07", "ZELLE"),
      c("aug14"),
    ]);
    expect(sel).toEqual(["jul31", "aug07"]);
  });

  it("keeps the primary first, so it stays primary on re-save", () => {
    const sel = selectionFor(t({ id: "X", commitment_id: "p" }), [
      c("a", "X"),
      c("p"),
      c("b", "X"),
    ]);
    expect(sel[0]).toBe("p");
    expect(sel.slice(1).sort()).toEqual(["a", "b"]);
  });

  it("ignores coverage belonging to a different payment", () => {
    expect(
      selectionFor(t({ id: "MINE", commitment_id: "p" }), [c("p"), c("other", "THEIRS")]),
    ).toEqual(["p"]);
  });

  it("an unlinked transaction selects nothing", () => {
    expect(selectionFor(t({ id: "X", commitment_id: null }), [c("a", "X")])).toEqual([]);
  });

  it("never lists the primary twice", () => {
    // defensive: a row that is somehow both linked and self-covered
    expect(selectionFor(t({ id: "X", commitment_id: "p" }), [c("p", "X")])).toEqual(["p"]);
  });
});

describe("settlementFor", () => {
  const zelle = t({ id: "ZELLE", commitment_id: "jul31", merchant: "Zelle Transfer to Sarah" });

  it("reads a direct link as paid", () => {
    const s = settlementFor(c("jul31"), [zelle]);
    expect(s?.viaCover).toBe(false);
    expect(s?.txn.id).toBe("ZELLE");
  });

  it("reads a covered week as settled by the payment that covered it", () => {
    const s = settlementFor(c("aug07", "ZELLE"), [zelle]);
    expect(s?.viaCover).toBe(true);
    expect(s?.txn.merchant).toBe("Zelle Transfer to Sarah");
  });

  it("an unsettled week returns nothing", () => {
    expect(settlementFor(c("aug14"), [zelle])).toBeNull();
  });

  it("survives a covering payment that has since been deleted", () => {
    expect(settlementFor(c("aug07", "GONE"), [zelle])).toBeNull();
  });
});
