/** Small UTC date helpers shared by the recurring + interest generators. */

/* The server runs in UTC, but "today" for generating transactions should be the
   user's calendar day — otherwise opening the app at 8pm Eastern (already
   tomorrow in UTC) posts next-day recurring/interest items a few hours early.
   Single-user app, so the zone is fixed here. */
export const APP_TIME_ZONE = "America/Indiana/Indianapolis";

/** Today's date (YYYY-MM-DD) in the app's time zone. */
export const todayISO = (timeZone: string = APP_TIME_ZONE) =>
  new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

/** Days in a given month (m0 = 0-based month). */
export const daysInMonth = (y: number, m0: number) =>
  new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

/** Last day of the current month (YYYY-MM-DD) in the app's time zone. The
 *  horizon for pre-posting this month's recurring items on manual accounts, so
 *  they're committed to the budget from the 1st. */
export const endOfMonthISO = (timeZone: string = APP_TIME_ZONE) => {
  const [y, m] = todayISO(timeZone).split("-").map(Number);
  const last = daysInMonth(y, m - 1);
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
};

/** Clamp a day-of-month to the month's length (e.g. 31 → 28/30/31). */
export const clampDay = (y: number, m0: number, day: number) =>
  Math.min(day, daysInMonth(y, m0));
