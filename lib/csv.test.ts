import { describe, it, expect } from "vitest";
import {
  parseCsv,
  detectHeaderRow,
  parseDate,
  parseAmount,
  buildRows,
} from "./csv";

const CLEAN = `Transaction Date,Description,Amount
06/22/2026,VERIZON WIRELESS,-73.70
06/21/2026,PHILO TV,-25.00`;

const MESSY = `Account,IU Credit Union MEMBER CHECKING
Account Number,xxxxxxxx0001
Statement Period,01/01/2026 - 06/20/2026
,
Posting Date,Description,Amount,Running Balance
06/19/2026,LOWES DEBIT 1234,-20.50,461.60
06/18/2026,DEPOSIT TRANSFER,300.00,738.09`;

describe("parseCsv", () => {
  it("parses rows and columns, dropping blank lines", () => {
    const rows = parseCsv(CLEAN);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["Transaction Date", "Description", "Amount"]);
    expect(rows[1]).toEqual(["06/22/2026", "VERIZON WIRELESS", "-73.70"]);
  });

  it("handles quoted fields with embedded commas", () => {
    const rows = parseCsv(`Date,Description,Amount\n06/01/2026,"ACME, INC.",-10.00`);
    expect(rows[1]).toEqual(["06/01/2026", "ACME, INC.", "-10.00"]);
  });

  it("handles escaped quotes", () => {
    const rows = parseCsv(`a,b\n"say ""hi""",2`);
    expect(rows[1][0]).toBe('say "hi"');
  });
});

describe("detectHeaderRow", () => {
  it("returns 0 for a clean file", () => {
    expect(detectHeaderRow(parseCsv(CLEAN))).toBe(0);
  });
  it("finds the header row partway down a messy file", () => {
    const rows = parseCsv(MESSY);
    // row index 3 holds "Posting Date,Description,Amount,Running Balance"
    expect(rows[detectHeaderRow(rows)]).toContain("Posting Date");
  });
});

describe("parseDate", () => {
  it("parses US M/D/YYYY", () => expect(parseDate("6/9/2026")).toBe("2026-06-09"));
  it("parses ISO", () => expect(parseDate("2026-06-09")).toBe("2026-06-09"));
  it("parses 2-digit year", () => expect(parseDate("06/09/26")).toBe("2026-06-09"));
  it("returns null for junk", () => expect(parseDate("not a date")).toBeNull());
});

describe("parseAmount", () => {
  it("parses negative with minus", () => expect(parseAmount("-73.70")).toBe(-73.7));
  it("strips $ and commas", () => expect(parseAmount("$1,234.56")).toBe(1234.56));
  it("treats parentheses as negative", () => expect(parseAmount("(45.32)")).toBe(-45.32));
  it("parses positive", () => expect(parseAmount("300.00")).toBe(300));
  it("returns null for empty", () => expect(parseAmount("")).toBeNull());
});

describe("buildRows", () => {
  const rows = parseCsv(MESSY);
  const header = detectHeaderRow(rows);
  const dataRows = rows.slice(header + 1);
  const map = { date: 0, description: 1, amount: 2 };

  it("builds parsed transactions and computes external_id", () => {
    const { rows: out, skipped } = buildRows(dataRows, map, false);
    expect(skipped).toBe(0);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ date: "2026-06-19", amount: -20.5, description: "LOWES DEBIT 1234" });
    expect(out[0].external_id).toBe("2026-06-19|-20.50|LOWES DEBIT 1234");
  });

  it("flips sign when requested", () => {
    const { rows: out } = buildRows(dataRows, map, true);
    expect(out[0].amount).toBe(20.5);
    expect(out[1].amount).toBe(-300);
  });

  it("skips rows with unparseable date or amount", () => {
    const { rows: out, skipped } = buildRows(
      [["bad", "x", "y"], ["06/01/2026", "OK", "-5.00"]],
      map,
      false,
    );
    expect(out).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});
