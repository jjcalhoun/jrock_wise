"use client";

/* A small on-brand loader: the gauge's petal arc, with segments pulsing in
   sequence while data loads. */

const W = 150;
const H = 92;
const CX = 75;
const CY = 80;
const R = 56;
const TH = 13;
const GAP = 5; // degrees
const COLORS = ["#3B82F6", "#EAB308", "#22C55E", "#14B8A6", "#A78BFA"];

const pt = (deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [CX + R * Math.cos(a), CY - R * Math.sin(a)];
};
const f = (p: [number, number]) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

export function GaugeLoader({ label = "Loading…" }: { label?: string }) {
  const n = COLORS.length;
  const span = 180 / n;
  const segs = COLORS.map((color, i) => {
    const aH = 180 - i * span - GAP / 2;
    const aL = 180 - (i + 1) * span + GAP / 2;
    return { color, d: `M ${f(pt(aH))} A ${R} ${R} 0 0 1 ${f(pt(aL))}`, delay: i * 0.12 };
  });

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {segs.map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={TH}
            strokeLinecap="round"
            className="petal-pulse"
            style={{ animationDelay: `${s.delay}s` }}
          />
        ))}
      </svg>
      <p className="text-sm" style={{ color: "var(--color-muted)" }}>
        {label}
      </p>
    </div>
  );
}
