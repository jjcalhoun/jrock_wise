import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/nav/BottomNav";
import { SideNav } from "@/components/nav/SideNav";
import { RecurringRunner } from "@/components/recurring/RecurringRunner";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen lg:flex" style={{ background: "var(--color-canvas)" }}>
      <RecurringRunner />
      {/* Desktop: sidebar; mobile: bottom nav (below) */}
      <SideNav />
      <main className="flex-1 min-w-0">
        <div className="relative mx-auto w-full max-w-[430px] lg:max-w-xl min-h-screen pt-safe">
          <div className="pb-28 lg:pb-10">{children}</div>
        </div>
      </main>
      <BottomNav />
    </div>
  );
}
