"use client";

import { useEffect, useRef } from "react";
import { usePostCharges } from "@/hooks/useCharges";
import { useSimplefinConnections, useSyncSimplefin } from "@/hooks/useSimplefin";
import { isDemo } from "@/lib/demo/isDemo";

/* Background housekeeping, once per app load — renders nothing.
   - Posts the carrying charges a manual liability account accrues on its own
     (interest, escrow) without waiting for the daily cron.
   - Kicks off a SimpleFIN sync when the newest sync is older than the
     throttle window, so opening the app is enough to pull fresh bank data. */

const SYNC_THROTTLE_MS = 4 * 60 * 60 * 1000; // at most every 4 hours

export function HousekeepingRunner() {
  const charges = usePostCharges();
  const sync = useSyncSimplefin();
  const { data: connections } = useSimplefinConnections();
  const ranCharges = useRef(false);
  const ranSync = useRef(false);

  useEffect(() => {
    if (isDemo || ranCharges.current) return; // demo: the seed is already whole
    ranCharges.current = true;
    charges.mutate();
  }, [charges]);

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
