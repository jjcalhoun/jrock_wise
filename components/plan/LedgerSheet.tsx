"use client";

import { Sheet } from "@/components/ui/Sheet";
import { Card } from "@/components/ui/Card";
import { fmt, fmt0, monthLabel } from "@/lib/format";
import type { Ledger } from "@/lib/monthPlan";

/* Read-only breakdown of the free-to-spend ledger: where the number comes
   from, line by line. Editing lives in the Month plan sheet. */

export function LedgerSheet({
  month,
  ledger,
  onEditPlan,
  onClose,
}: {
  month: string;
  ledger: Ledger;
  onEditPlan: () => void;
  onClose: () => void;
}) {
  const incomeItems = ledger.items.filter((i) => i.kind === "income" && !i.excluded);
  const commitments = ledger.items.filter((i) => i.kind !== "income" && !i.excluded);

  return (
    <Sheet title={`${monthLabel(month)} ledger`} onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <Card className="p-4 text-center">
          <p className="text-xs" style={{ color: "var(--color-muted)" }}>
            Free to spend
          </p>
          <p
            className="font-figure text-3xl font-bold mt-1"
            style={{ color: ledger.freeToSpend >= 0 ? "var(--color-positive)" : "var(--color-danger)" }}
          >
            {fmt(ledger.freeToSpend)}
          </p>
        </Card>

        {incomeItems.length > 0 && (
          <Section title="Income">
            {incomeItems.map((i) => (
              <Row
                key={i.id}
                name={i.name}
                sub={i.status === "paid" ? "received" : "expected"}
                value={fmt(i.effective)}
                dim={i.status !== "paid"}
                positive
              />
            ))}
            {ledger.extraIncome > 0 && (
              <Row name="Extra income" sub="beyond the plan" value={fmt(ledger.extraIncome)} positive />
            )}
          </Section>
        )}

        {commitments.length > 0 && (
          <Section title="Committed payments">
            {commitments.map((i) => (
              <Row
                key={i.id}
                name={i.name}
                sub={i.status === "paid" ? "paid" : "upcoming"}
                value={fmt(i.effective)}
                dim={i.status !== "paid"}
              />
            ))}
          </Section>
        )}

        <Section title="Everything else">
          <Row name="Discretionary spending" sub="unplanned, so far" value={`−${fmt0(ledger.discretionary)}`} />
        </Section>

        <Card className="p-4 space-y-1.5">
          <Summary label="Expected income" value={fmt0(ledger.incomeEffective + ledger.extraIncome)} />
          <Summary label="Committed payments" value={`−${fmt0(ledger.commitmentsEffective)}`} />
          <Summary label="Discretionary spending" value={`−${fmt0(ledger.discretionary)}`} />
          <div className="pt-1.5" style={{ borderTop: "1px solid var(--color-hairline)" }}>
            <Summary
              label="Free to spend"
              value={fmt0(ledger.freeToSpend)}
              accent={ledger.freeToSpend >= 0 ? "var(--color-positive)" : "var(--color-danger)"}
              bold
            />
          </div>
        </Card>

        <button
          onClick={onEditPlan}
          className="w-full text-xs font-semibold py-1"
          style={{ color: "var(--color-primary)" }}
        >
          Edit month plan
        </button>
      </div>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
        {title}
      </p>
      <Card className="divide-y" style={{ borderColor: "var(--color-hairline)" }}>
        {children}
      </Card>
    </div>
  );
}

function Row({
  name,
  sub,
  value,
  dim,
  positive,
}: {
  name: string;
  sub: string;
  value: string;
  dim?: boolean;
  positive?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5" style={{ opacity: dim ? 0.6 : 1 }}>
      <div className="min-w-0">
        <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>
          {name}
        </p>
        <p className="text-xs" style={{ color: "var(--color-faint)" }}>
          {sub}
        </p>
      </div>
      <span
        className="font-figure text-sm shrink-0"
        style={{ color: positive ? "var(--color-positive)" : "var(--color-text)" }}
      >
        {value}
      </span>
    </div>
  );
}

function Summary({
  label,
  value,
  accent,
  bold,
}: {
  label: string;
  value: string;
  accent?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: "var(--color-muted)" }}>{label}</span>
      <span className="font-figure" style={{ color: accent ?? "var(--color-text)", fontWeight: bold ? 700 : 500 }}>
        {value}
      </span>
    </div>
  );
}
