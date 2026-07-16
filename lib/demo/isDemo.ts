/** Demo mode: no database, no auth — the app runs on a deterministic,
 *  seeded in-browser dataset that rolls forward daily. Enabled by deploying
 *  with NEXT_PUBLIC_DEMO=1 (a separate Vercel project on the same repo). */
export const isDemo = process.env.NEXT_PUBLIC_DEMO === "1";

export const DEMO_USER_ID = "demo-user";
