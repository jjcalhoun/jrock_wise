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

/* Layout constants for the half-circle petal fan. */
const W = 320;
const H = 168;
const CX = W / 2;
const CY = 150; // gauge center near the bottom
const BASE_R = 34; // inner radius where petals begin
const ARC_START = 168; // left-most petal angle (degrees)
const ARC_END = 12; // right-most petal angle
const MAX_PETALS = 8;

export function Gauge({ segments, spent, budget }: Props) {
  const over = budget > 0 && spent > budget;

  // top categories by spend, largest first
  const petals = [...segments]
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_PETALS);

  const maxVal = Math.max(...petals.map((p) => p.value), 1);
  const n = petals.length;

  return (
    <div className="relative" style={{ width: W, height: H }}>
      {/* subtle base arc */}
      <svg width={W} height={H} className="absolute inset-0">
        <path
          d={`M ${CX - BASE_R} ${CY} A ${BASE_R} ${BASE_R} 0 0 1 ${CX + BASE_R} ${CY}`}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      </svg>

      {petals.map((p, i) => {
        // even angular distribution across the arc (single petal sits at top)
        const t = n === 1 ? 0.5 : i / (n - 1);
        const angle = ARC_START + (ARC_END - ARC_START) * t;
        const rad = (angle * Math.PI) / 180;

        const frac = p.value / maxVal;
        const len = 44 + frac * 42; // petal length
        const wid = 30 + frac * 16; // petal width
        const R = BASE_R + len / 2;

        const x = CX + R * Math.cos(rad);
        const y = CY - R * Math.sin(rad);
        const rotate = 90 - angle; // point the petal radially outward

        return (
          <div
            key={i}
            className="absolute flex items-start justify-center"
            style={{
              left: x,
              top: y,
              width: wid,
              height: len,
              borderRadius: 16,
              background: over ? "var(--color-danger)" : p.color,
              transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
              paddingTop: 8,
            }}
          >
            {/* counter-rotate the icon so it stays upright */}
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 18, color: "#fff", transform: `rotate(${-rotate}deg)` }}
            >
              {p.icon}
            </span>
          </div>
        );
      })}

      {/* center readout */}
      <div className="absolute inset-x-0 text-center" style={{ top: CY - 56 }}>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Spent
        </p>
        <p
          className="font-figure text-3xl font-bold leading-tight"
          style={{ color: over ? "var(--color-danger)" : "var(--color-text)" }}
        >
          {fmt0(spent)}
        </p>
        <p className="text-xs" style={{ color: "var(--color-faint)" }}>
          of {fmt0(budget)} budget
        </p>
      </div>
    </div>
  );
}
