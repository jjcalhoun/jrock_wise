import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/nav/BottomNav";
import { SideNav } from "@/components/nav/SideNav";
import { RecurringRunner } from "@/components/recurring/RecurringRunner";
import { MonthPlanPrompt } from "@/components/plan/MonthPlanPrompt";

const demo = process.env.NEXT_PUBLIC_DEMO === "1";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!demo) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      redirect("/login");
    }
  }

  return (
    <div className="min-h-screen lg:flex" style={{ background: "var(--color-canvas)" }}>
      {demo && (
        <div
          className="fixed top-0 inset-x-0 z-[60] text-center text-[11px] font-semibold py-1 text-white"
          style={{ background: "var(--color-primary)" }}
        >
          Demo — fictional data, resets daily
        </div>
      )}
      <RecurringRunner />
      <MonthPlanPrompt />
      {/* Desktop: sidebar; mobile: bottom nav (below) */}
      <SideNav />
      <main className="flex-1 min-w-0">
        <div className="relative mx-auto w-full max-w-[430px] lg:max-w-4xl xl:max-w-5xl 2xl:max-w-6xl min-h-screen pt-safe lg:px-6">
          <div className="pb-28 lg:pb-10">{children}</div>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
