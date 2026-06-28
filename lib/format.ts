/** Money + date formatting helpers (ported from BudgetApp.jsx prototype). */

/** "$1,234.56" with sign for negatives. */
export function fmt(n: number): string {
  const sign = n < 0 ? "-" : "";
  return (
    sign +
    "$" +
    Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/** "$1,234" — no decimals. */
export function fmt0(n: number): string {
  const sign = n < 0 ? "-" : "";
  return sign + "$" + Math.abs(Math.round(n)).toLocaleString("en-US");
}

/** "$1.2K" for large figures, else fmt0. */
export function fmtK(n: number): string {
  const a = Math.abs(n);
  if (a >= 1000) return (n < 0 ? "-" : "") + "$" + (a / 1000).toFixed(1) + "K";
  return fmt0(n);
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "June 2026" from a "YYYY-MM" key. */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "6/24" short date from an ISO date string. */
export function shortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** current "YYYY-MM" key. */
export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
