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

/* Half-circle petal fan. All petals share one arc radius so they form a clean
   ring; only their length/width vary with spend. The center stays open for the
   readout. */
const W = 320;
const H = 184;
const CX = W / 2;
const CY = 168; // gauge center near the bottom
const ARC_R = 102; // constant radius to each petal's center — keeps the center clear
const MAX_PETALS = 7;

export function Gauge({ segments, spent, budget }: Props) {
  const over = budget > 0 && spent > budget;

  const petals = [...segments]
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_PETALS);

  const maxVal = Math.max(...petals.map((p) => p.value), 1);
  const n = petals.length;
  const slice = 180 / n; // degrees per petal

  return (
    <div className="relative" style={{ width: W, height: H }}>
      {/* faint track behind the petals */}
      <svg width={W} height={H} className="absolute inset-0">
        <path
          d={`M ${CX - ARC_R} ${CY} A ${ARC_R} ${ARC_R} 0 0 1 ${CX + ARC_R} ${CY}`}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth={2}
        />
      </svg>

      {petals.map((p, i) => {
        // place each petal at the midpoint of its angular slice, biggest on the left
        const angle = 180 - (i + 0.5) * slice;
        const rad = (angle * Math.PI) / 180;

        const frac = p.value / maxVal;
        const len = 48 + frac * 18; // radial length (gentler variation)
        const wid = Math.min(slice * 0.95, 34 + frac * 12); // chunkier, just under the slice

        const x = CX + ARC_R * Math.cos(rad);
        const y = CY - ARC_R * Math.sin(rad);
        const rotate = 90 - angle; // point outward

        return (
          <div
            key={i}
            className="absolute flex items-start justify-center"
            style={{
              left: x,
              top: y,
              width: wid,
              height: len,
              borderRadius: 14,
              background: over ? "var(--color-danger)" : p.color,
              transform: `translate(-50%, -50%) rotate(${rotate}deg)`,
              paddingTop: 7,
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: 17, color: "#fff", transform: `rotate(${-rotate}deg)` }}
            >
              {p.icon}
            </span>
          </div>
        );
      })}

      {/* center readout */}
      <div className="absolute inset-x-0 text-center" style={{ top: CY - 64 }}>
        <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
          Spent
        </p>
        <p
          className="font-figure text-[26px] font-bold leading-tight"
          style={{ color: over ? "var(--color-danger)" : "var(--color-text)" }}
        >
          {fmt0(spent)}
        </p>
        <p className="text-[11px]" style={{ color: "var(--color-faint)" }}>
          of {fmt0(budget)} budget
        </p>
      </div>
    </div>
  );
}
