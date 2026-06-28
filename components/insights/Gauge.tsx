"use client";

import { fmt0 } from "@/lib/format";

export interface GaugeSegment {
  color: string;
  value: number; // spend for this category
}

interface Props {
  segments: GaugeSegment[];
  spent: number;
  budget: number;
}

const R = 90;
const CX = 110;
const CY = 110;
const THICK = 18;

/** point on the upper semicircle for t in [0,1] (0 = left, 1 = right) */
function point(t: number) {
  const theta = (Math.PI * (1 - t)); // π → 0
  return { x: CX + R * Math.cos(theta), y: CY - R * Math.sin(theta) };
}

function arcPath(t0: number, t1: number) {
  const a = point(t0);
  const b = point(t1);
  // each segment spans < 180°, so large-arc = 0; sweeping left→right over the
  // top is a clockwise arc in SVG's y-down space → sweep flag 1.
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 0 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

export function Gauge({ segments, spent, budget }: Props) {
  const over = budget > 0 && spent > budget;
  const denom = budget > 0 ? budget : Math.max(spent, 1);

  // Build cumulative category arcs across the half-circle (capped at full).
  let cursor = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s, i) => {
      const start = cursor;
      const frac = Math.min(s.value / denom, 1 - start);
      cursor = Math.min(1, start + Math.max(0, frac));
      return { key: i, color: s.color, t0: start, t1: cursor };
    })
    .filter((a) => a.t1 > a.t0);

  return (
    <div className="relative flex flex-col items-center">
      <svg width={220} height={130} viewBox="0 0 220 130">
        {/* track */}
        <path
          d={arcPath(0, 1)}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth={THICK}
          strokeLinecap="round"
        />
        {/* category segments */}
        {arcs.map((a) => (
          <path
            key={a.key}
            d={arcPath(a.t0, a.t1)}
            fill="none"
            stroke={over ? "var(--color-danger)" : a.color}
            strokeWidth={THICK}
            strokeLinecap="butt"
          />
        ))}
      </svg>

      {/* center readout */}
      <div className="absolute inset-x-0 top-[58px] text-center">
        <p
          className="font-figure text-3xl font-bold"
          style={{ color: over ? "var(--color-danger)" : "var(--color-text)" }}
        >
          {fmt0(spent)}
        </p>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          of {fmt0(budget)} budget
        </p>
      </div>
    </div>
  );
}
