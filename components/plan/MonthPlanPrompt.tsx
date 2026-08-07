"use client";

import { useEffect, useRef, useState } from "react";
import { usePlanPeriod } from "@/hooks/usePlanPeriod";
import { MonthPlanSheet } from "@/components/plan/MonthPlanSheet";
import { currentMonthKey } from "@/lib/format";

/* Opens the month-plan sheet once per app load while the current month's plan
   is missing or unconfirmed — the "confirm your July plan" moment. Dismissing
   without confirming just defers to the next app open. */
export function MonthPlanPrompt() {
  const month = currentMonthKey();
  const { data, isLoading } = usePlanPeriod(month);
  const [open, setOpen] = useState(false);
  const prompted = useRef(false);

  useEffect(() => {
    if (isLoading || prompted.current) return;
    if (!data?.confirmed_at) {
      prompted.current = true;
      setOpen(true);
    }
  }, [isLoading, data]);

  if (!open) return null;
  return <MonthPlanSheet month={month} onClose={() => setOpen(false)} />;
}
