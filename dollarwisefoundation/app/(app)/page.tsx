export default function HomePage() {
  return (
    <main className="p-4">
      <div
        className="rounded-[16px] p-6 bg-hero-gradient text-white"
      >
        <p className="text-sm font-medium opacity-80">Safe to spend</p>
        <p className="font-figure text-5xl font-bold mt-1">$0</p>
        <p className="text-sm opacity-70 mt-1">this month</p>
      </div>

      <div className="mt-6 text-center" style={{ color: "var(--color-muted)" }}>
        <p className="text-sm">Connect Supabase to load your data.</p>
      </div>
    </main>
  );
}
