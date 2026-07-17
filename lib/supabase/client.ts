import { createBrowserClient } from "@supabase/ssr";
import { isDemo } from "@/lib/demo/isDemo";
import { createDemoClient } from "@/lib/demo/client";

export function createClient() {
  if (isDemo) {
    // Demo mode: a Supabase-shaped client over a seeded in-browser dataset —
    // no database, no auth. See lib/demo/*. (Cast to `never` so the return
    // type stays the real browser client's inferred type.)
    return createDemoClient() as never;
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
