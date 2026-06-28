import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BottomNav } from "@/components/nav/BottomNav";

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
    <div className="relative mx-auto w-full max-w-[430px] min-h-screen" style={{ background: "var(--color-canvas)" }}>
      <div className="pb-24">{children}</div>
      <BottomNav />
    </div>
  );
}
