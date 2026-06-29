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
   budget so the arc is always complete. A thin baseline arc separates the
   gauge from the readout below. */
const W = 320;
const H = 176;
const CX = W / 2;
const CY = 150;
const RC = 84; // centerline radius
const TH = 30; // wedge thickness
const GAP = 4; // degrees of gap between wedges
const MIN_CAT = 26; // min degrees per category so its icon stays visible
const CORNER = 7; // wedge corner radius (rounded but not pill)
const MAX_PETALS = 7;
const REMAIN_COLOR = "#9A938A";

const Ri = RC - TH / 2;
const Ro = RC + TH / 2;
const DEG = 180 / Math.PI;

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

export function Gauge({ segments, spent, budget }: Props) {
  const cats = [...segments]
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_PETALS);

  const totalSpent = cats.reduce((s, c) => s + c.value, 0);
  const denom = Math.max(budget, totalSpent, 1);
  const leftover = Math.max(0, denom - totalSpent);

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

  let cursor = 180;
  const wedges = segs.map((s) => {
    const aH = cursor;
    const aL = cursor - s.span + GAP;
    const mid = cursor - s.span / 2;
    cursor -= s.span;
    return { d: wedgePath(aH - GAP / 2, aL - GAP / 2), color: s.color, icon: s.icon, mid };
  });

  // thin baseline arc just inside the ring
  const tR = Ri - 3;
  const baseline = `M ${f(pt(tR, 180))} A ${tR} ${tR} 0 0 1 ${f(pt(tR, 0))}`;

  return (
    <div className="relative" style={{ width: W, height: H }}>
      <svg width={W} height={H} className="absolute inset-0">
        <path d={baseline} fill="none" stroke="var(--color-hairline)" strokeWidth={2.5} />
        {wedges.map((w, i) => (
          <path key={i} d={w.d} fill={w.color} />
        ))}
      </svg>

      {wedges.map(
        (w, i) =>
          w.icon && (
            <span
              key={i}
              className="material-symbols-outlined absolute"
              style={{
                left: pt(RC, w.mid)[0],
                top: pt(RC, w.mid)[1],
                transform: "translate(-50%, -50%)",
                fontSize: 16,
                color: "#fff",
              }}
            >
              {w.icon}
            </span>
          ),
      )}

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
