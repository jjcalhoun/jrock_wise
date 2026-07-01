/** Small UTC date helpers shared by the recurring + interest generators. */

/** Days in a given month (m0 = 0-based month). */
export const daysInMonth = (y: number, m0: number) =>
  new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Clamp a day-of-month to the month's length (e.g. 31 → 28/30/31). */
export const clampDay = (y: number, m0: number, day: number) =>
  Math.min(day, daysInMonth(y, m0));
