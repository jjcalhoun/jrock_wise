"use client";

import { useEffect, useRef } from "react";
import { useGenerateRecurring } from "@/hooks/useRecurring";

/* Fires the recurring generator once per app load, so due transactions appear
   without waiting for the daily cron. Renders nothing. */
export function RecurringRunner() {
  const generate = useGenerateRecurring();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    generate.mutate();
  }, [generate]);

  return null;
}
