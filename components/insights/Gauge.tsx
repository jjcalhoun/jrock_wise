"use client";

import { fmt0 } from "@/lib/format";

export interface GaugeSegment {
  color: string;
  value: number; // spend for this category
  icon: string; // Material Symbols name
}

interface Props {
  segments: GaugeSegment[];
  spent: number;
  budget: number;
}

/* The half-circle is divided into proportional wedges: each category's width
   grows with its spend, and a neutral "remaining" wedge fills the rest of the
   budget so the arc is always complete. */
const W = 320;
const H = 176;
const CX = W / 2;
const CY = 150;
const RC = 84; // centerline radius
const TH = 28; // wedge thickness
const GAP = 3; // degrees of gap between wedges
const MIN_CAT = 26; // min degrees per category so its icon stays visible
const MAX_PETALS = 7;
const REMAIN_COLOR = "#9A938A";

const capDeg = ((TH / 2) / RC) * (180 / Math.PI);
const point = (a: number) => ({
  x: CX + RC * Math.cos((a * Math.PI) / 180),
  y: CY - RC * Math.sin((a * Math.PI) / 180),
});

export function Gauge({ segments, spent, budget }: Props) {
  const cats = [...segments]
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_PETALS);

  const totalSpent = cats.reduce((s, c) => s + c.value, 0);
  const denom = Math.max(budget, totalSpent, 1);
  const leftover = Math.max(0, denom - totalSpent);

  // angular span per category (with a minimum), remainder fills the rest
  let catSpans = cats.map((c) => Math.max(MIN_CAT, (c.value / denom) * 180));
  let sumCat = catSpans.reduce((a, b) => a + b, 0);
  let remSpan = leftover > 0 ? 180 - sumCat : 0;
  if (remSpan < 0 || leftover <= 0) {
    const scale = 180 / sumCat;
    catSpans = catSpans.map((x) => x * scale);
    remSpan = 0;
  }

  type Seg = { color: string; icon?: string; span: number };
  const segs: Seg[] = cats.map((c, i) => ({ color: c.color, icon: c.icon, span: catSpans[i] }));
  if (remSpan > GAP) segs.push({ color: REMAIN_COLOR, span: remSpan });

  // lay segments out adjacent from the left (180°) to the right (0°)
  let cursor = 180;
  const rendered = segs.map((s) => {
    const segStart = cursor;
    const segEnd = cursor - s.span;
    const mid = cursor - s.span / 2;
    cursor = segEnd;

    let a1 = segStart - (capDeg + GAP / 2);
    let a2 = segEnd + (capDeg + GAP / 2);
    if (a1 <= a2) {
      a1 = mid + 0.01;
      a2 = mid - 0.01;
    }
    const p1 = point(a1);
    const p2 = point(a2);
    return { d: `M ${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A ${RC} ${RC} 0 0 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`, color: s.color, icon: s.icon, mid };
  });

  return (
    <div className="relative" style={{ width: W, height: H }}>
      <svg width={W} height={H} className="absolute inset-0">
        {rendered.map((r, i) => (
          <path
            key={i}
            d={r.d}
            fill="none"
            stroke={r.color}
            strokeWidth={TH}
            strokeLinecap="round"
          />
        ))}
      </svg>

      {/* category icons at each wedge midpoint */}
      {rendered.map(
        (r, i) =>
          r.icon && (
            <span
              key={i}
              className="material-symbols-outlined absolute"
              style={{
                left: point(r.mid).x,
                top: point(r.mid).y,
                transform: "translate(-50%, -50%)",
                fontSize: 16,
                color: "#fff",
              }}
            >
              {r.icon}
            </span>
          ),
      )}

      {/* center readout */}
      <div className="absolute inset-x-0 text-center" style={{ top: CY - 64 }}>
        <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
          Spent
        </p>
        <p className="font-figure text-[26px] font-bold leading-tight" style={{ color: "var(--color-text)" }}>
          {fmt0(spent)}
        </p>
        <p className="text-[11px]" style={{ color: "var(--color-faint)" }}>
          of {fmt0(budget)} budget
        </p>
      </div>
    </div>
  );
}
