import { Suspense } from "react";
import { ActivityScreen } from "@/components/activity/ActivityScreen";

export default function ActivityPage() {
  return (
    <Suspense fallback={<main className="p-4" />}>
      <ActivityScreen />
    </Suspense>
  );
}
