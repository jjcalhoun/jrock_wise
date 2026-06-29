/**
 * CSV parsing for the import wizard.
 *  - Tolerant row parser (quotes, embedded commas, CRLF).
 *  - Header-row detection (some bank exports put account info in the first rows).
 *  - Flexible date + amount parsing across common bank formats.
 */

/** Parse raw CSV text into a grid of string cells. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    // skip fully-empty rows
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else if (ch === "\r") {
      // handled by the \n that follows (or ignore lone \r)
    } else {
      field += ch;
    }
  }
  // trailing field/row
  if (field !== "" || row.length > 0) pushRow();

  return rows;
}

/**
 * Guess which row holds the column headers: the first row that has the most
 * non-empty cells and contains a date-like or amount-like header word.
 * Returns a 0-based index (defaults to 0).
 */
export function detectHeaderRow(rows: string[][]): number {
  const HINTS = ["date", "amount", "description", "debit", "credit", "balance", "payee", "memo"];
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(rows.length, 15);
  for (let i = 0; i < limit; i++) {
    const cells = rows[i].map((c) => c.toLowerCase().trim());
    const nonEmpty = cells.filter((c) => c !== "").length;
    const hintHits = cells.filter((c) => HINTS.some((h) => c.includes(h))).length;
    const score = hintHits * 10 + nonEmpty;
    if (hintHits > 0 && score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Parse a date cell into an ISO "YYYY-MM-DD" string, or null. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;

  // already ISO
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // M/D/YYYY or M-D-YYYY (US) and M/D/YY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = String(2000 + Number(y));
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // fall back to Date()
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  return null;
}

/** Parse an amount cell into a signed number, or null. Handles $, commas,
 *  parentheses-as-negative, and trailing/leading minus. */
export function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.includes("-")) negative = true;
  s = s.replace(/[^0-9.]/g, "");
  if (s === "" || s === ".") return null;
  const n = Number(s);
  if (isNaN(n)) return null;
  return negative ? -n : n;
}

export interface ColumnMap {
  date: number;
  amount: number;
  description: number;
}

export interface ParsedRow {
  date: string; // ISO
  amount: number; // signed (after optional flip)
  description: string;
  external_id: string; // for dedupe
}

/**
 * Turn data rows into parsed transactions using the column map.
 * @param flipSign  negate amounts (for files that show spending as positive).
 */
export function buildRows(
  dataRows: string[][],
  map: ColumnMap,
  flipSign: boolean,
): { rows: ParsedRow[]; skipped: number } {
  const rows: ParsedRow[] = [];
  let skipped = 0;
  for (const cells of dataRows) {
    const date = parseDate(cells[map.date] ?? "");
    const amt = parseAmount(cells[map.amount] ?? "");
    const description = (cells[map.description] ?? "").trim();
    if (!date || amt === null) {
      skipped++;
      continue;
    }
    const amount = flipSign ? -amt : amt;
    rows.push({
      date,
      amount,
      description,
      external_id: `${date}|${amount.toFixed(2)}|${description}`.slice(0, 200),
    });
  }
  return { rows, skipped };
}
