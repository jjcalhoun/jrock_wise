"use client";

import { useState } from "react";
import { fmt0 } from "@/lib/format";

export interface GaugePetal {
  key: string;
  label: string;
  color: string;
  icon: string;
  actual: number; // spent this month
  budget: number; // budgeted amount
  avg3: number; // 3-month average
  breakdown?: { label: string; value: number }[]; // optional detail (e.g. per-loan)
}

interface Props {
  petals: GaugePetal[];
  income: number; // expected income — the arc's baseline scale
  onPetalClick?: (key: string) => void;
}

/* Budget arc. The whole half-circle represents expected income; each petal is
   sized to scale by max(budget, actual), so the plan is visible from day one and
   a petal grows past its budget when overspent. A solid inner arc fills toward
   the budget as money is actually spent. Hover/tap a petal for actual-vs-budget
   and the 3-month average. */
const VB_W = 360;
const VB_H = 232;
const CX = VB_W / 2;
const CY = 196;
const RC = 156;
const TH = 42;
const GAP = 3.5;
const CORNER = 10;
const MIN_ICON_DEG = 15; // below this a petal is color-only (no icon)

const Ri = RC - TH / 2;
const Ro = RC + TH / 2;
const DEG = 180 / Math.PI;
const REMAIN_COLOR = "#9A938A";

const pt = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
};
const f = (p: [number, number]) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;

/** Filled rounded-corner wedge between high/low angles, across [Ri, Ro]. */
function wedgePath(aH: number, aL: number): string {
  let rc = Math.min(CORNER, ((aH - aL) * Ro) / DEG / 2 - 1);
  if (rc < 1) rc = 1;
  const phiO = (rc / Ro) * DEG;
  const phiI = (rc / Ri) * DEG;
  const A = pt(Ro, aH - phiO);
  const B = pt(Ro, aL + phiO);
  const C = pt(Ro - rc, aL);
  const D = pt(Ri + rc, aL);
  const E = pt(Ri, aL + phiI);
  const F = pt(Ri, aH - phiI);
  const G = pt(Ri + rc, aH);
  const Hh = pt(Ro - rc, aH);
  return (
    `M ${f(A)} A ${Ro} ${Ro} 0 0 1 ${f(B)} A ${rc} ${rc} 0 0 1 ${f(C)} ` +
    `L ${f(D)} A ${rc} ${rc} 0 0 1 ${f(E)} A ${Ri} ${Ri} 0 0 0 ${f(F)} ` +
    `A ${rc} ${rc} 0 0 1 ${f(G)} L ${f(Hh)} A ${rc} ${rc} 0 0 1 ${f(A)} Z`
  );
}

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

export function Gauge({ petals, income, onPetalClick }: Props) {
  const [active, setActive] = useState<string | null>(null);

  const sized = petals
    .map((p) => ({ ...p, size: Math.max(p.budget, p.actual) }))
    .filter((p) => p.size > 0)
    .sort((a, b) => b.size - a.size);

  const totalSize = sized.reduce((s, p) => s + p.size, 0);
  const totalActual = petals.reduce((s, p) => s + Math.max(0, p.actual), 0);
  const denom = Math.max(income, totalSize, 1);
  const remainderSpan = ((denom - totalSize) / denom) * 180;

  let cursor = 180;
  const wedges = sized.map((p) => {
    const span = (p.size / denom) * 180;
    const aH = cursor - GAP / 2;
    const aL = cursor - span + GAP / 2;
    const mid = (aH + aL) / 2;
    const actualFrac = p.size > 0 ? Math.min(1, Math.max(0, p.actual) / p.size) : 0;
    const actualLow = aH - (aH - aL) * actualFrac;
    cursor -= span;
    return { p, aH, aL, mid, span, actualFrac, actualLow };
  });

  const activePetal = wedges.find((w) => w.p.key === active);

  return (
    <div className="relative w-full">
      <svg width="100%" viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ display: "block" }}>
        {/* baseline track */}
        <path
          d={`M ${f(pt(Ri - 3, 180))} A ${Ri - 3} ${Ri - 3} 0 0 1 ${f(pt(Ri - 3, 0))}`}
          fill="none"
          stroke="var(--color-hairline)"
          strokeWidth={2.5}
        />
        {wedges.map((w) => (
          <g key={w.p.key}>
            {/* faint full-budget footprint */}
            <path d={wedgePath(w.aH, w.aL)} fill={w.p.color} opacity={0.3} />
            {/* solid actual fill */}
            {w.actualFrac > 0.01 && (
              <path d={wedgePath(w.aH, w.actualLow)} fill={w.p.color} />
            )}
            {/* active ring */}
            {active === w.p.key && (
              <path d={wedgePath(w.aH, w.aL)} fill="none" stroke="#fff" strokeOpacity={0.5} strokeWidth={1.5} />
            )}
            {/* transparent hit target on top — reliable tap/click across devices */}
            <path
              d={wedgePath(w.aH, w.aL)}
              fill="transparent"
              style={{ pointerEvents: "all", cursor: onPetalClick ? "pointer" : "default", touchAction: "manipulation" }}
              onMouseEnter={() => setActive(w.p.key)}
              onMouseLeave={() => setActive((k) => (k === w.p.key ? null : k))}
              onClick={() => {
                setActive(w.p.key);
                onPetalClick?.(w.p.key);
              }}
            />
          </g>
        ))}
        {/* neutral remainder (unallocated income) */}
        {remainderSpan > GAP && (
          <path
            d={wedgePath(cursor - GAP / 2, cursor - remainderSpan + GAP / 2)}
            fill={REMAIN_COLOR}
            opacity={0.5}
          />
        )}
      </svg>

      {/* icons — only where the petal is wide enough */}
      {wedges.map((w) =>
        w.span >= MIN_ICON_DEG ? (
          <span
            key={`ic-${w.p.key}`}
            className="material-symbols-outlined absolute pointer-events-none"
            style={{
              left: pct(pt(RC, w.mid)[0], VB_W),
              top: pct(pt(RC, w.mid)[1], VB_H),
              transform: "translate(-50%, -50%)",
              fontSize: 22,
              color: "#fff",
            }}
          >
            {w.p.icon}
          </span>
        ) : null,
      )}

      {/* center readout */}
      <div className="absolute inset-x-0 text-center" style={{ top: pct(CY - 92, VB_H) }}>
        <p className="text-xs" style={{ color: "var(--color-muted)" }}>
          Spent
        </p>
        <p className="font-figure text-[32px] font-bold leading-tight" style={{ color: "var(--color-text)" }}>
          {fmt0(totalActual)}
        </p>
        <p className="text-xs" style={{ color: "var(--color-faint)" }}>
          of {fmt0(income)} income
        </p>
      </div>

      {/* tooltip */}
      {activePetal && (
        <div
          className="absolute z-10 -translate-x-1/2 -translate-y-full rounded-[10px] px-3 py-2 pointer-events-none shadow-lg"
          style={{
            left: pct(pt(RC, activePetal.mid)[0], VB_W),
            top: `calc(${pct(pt(Ro, activePetal.mid)[1], VB_H)} - 6px)`,
            background: "var(--color-elevated)",
            border: "1px solid var(--color-hairline)",
            minWidth: 150,
            maxWidth: 220,
          }}
        >
          <p className="text-xs font-semibold mb-0.5" style={{ color: "var(--color-text)" }}>
            {activePetal.p.label}
          </p>
          <p className="text-[11px]" style={{ color: "var(--color-muted)" }}>
            {fmt0(activePetal.p.actual)} of {fmt0(activePetal.p.budget)} budget
          </p>
          <p className="text-[11px]" style={{ color: "var(--color-faint)" }}>
            3-mo avg {fmt0(activePetal.p.avg3)}
          </p>
          {activePetal.p.breakdown && activePetal.p.breakdown.length > 0 && (
            <div className="mt-1 pt-1 space-y-0.5" style={{ borderTop: "1px solid var(--color-hairline)" }}>
              {activePetal.p.breakdown.map((b) => (
                <p key={b.label} className="text-[11px] flex justify-between gap-3" style={{ color: "var(--color-muted)" }}>
                  <span className="truncate">{b.label}</span>
                  <span className="font-figure shrink-0" style={{ color: "var(--color-text)" }}>
                    {fmt0(b.value)}
                  </span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
