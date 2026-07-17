"use client";

import { useEffect, useRef } from "react";
import { useGenerateRecurring } from "@/hooks/useRecurring";
import { useSimplefinConnections, useSyncSimplefin } from "@/hooks/useSimplefin";
import { isDemo } from "@/lib/demo/isDemo";

/* Background housekeeping, once per app load — renders nothing.
   - Fires the recurring generator so due transactions appear without waiting
     for the daily cron.
   - Kicks off a SimpleFIN sync when the newest sync is older than the
     throttle window, so opening the app is enough to pull fresh bank data. */

const SYNC_THROTTLE_MS = 4 * 60 * 60 * 1000; // at most every 4 hours

export function RecurringRunner() {
  const generate = useGenerateRecurring();
  const sync = useSyncSimplefin();
  const { data: connections } = useSimplefinConnections();
  const ranGenerate = useRef(false);
  const ranSync = useRef(false);

  useEffect(() => {
    if (isDemo || ranGenerate.current) return; // demo: the seed IS the generator
    ranGenerate.current = true;
    generate.mutate();
  }, [generate]);

  useEffect(() => {
    if (isDemo || ranSync.current || !connections || connections.length === 0) return;
    const newest = connections.reduce<string | null>(
      (acc, c) => (c.last_synced_at && (!acc || c.last_synced_at > acc) ? c.last_synced_at : acc),
      null,
    );
    const stale = !newest || Date.now() - Date.parse(newest) > SYNC_THROTTLE_MS;
    if (!stale) return;
    ranSync.current = true;
    sync.mutate(undefined);
  }, [connections, sync]);

  return null;
}
