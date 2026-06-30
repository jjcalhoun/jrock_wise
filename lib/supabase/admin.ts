import { createClient } from "@supabase/supabase-js";

/* Service-role Supabase client — bypasses RLS, so it is SERVER-ONLY and used
   only by trusted background jobs (the cron sync) that have no user session.
   Never import this into client code. Every query must scope by user_id itself,
   since RLS no longer does it. */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
