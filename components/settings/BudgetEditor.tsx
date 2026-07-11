"use client";

import { useState, useEffect } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useBudget, useUpdateBudget } from "@/hooks/useSupabaseData";
import { BUCKETS } from "@/lib/buckets";
import { fmt0 } from "@/lib/format";

export function BudgetEditor({ onClose }: { onClose: () => void }) {
  const { data: budget } = useBudget();
  const update = useUpdateBudget();

  const [income, setIncome] = useState("");
  const [needs, setNeeds] = useState(50);
  const [wants, setWants] = useState(30);
  const [savings, setSavings] = useState(20);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (budget) {
      setIncome(String(budget.income));
      setNeeds(budget.plan_needs);
      setWants(budget.plan_wants);
      setSavings(budget.plan_savings);
    }
  }, [budget]);

  const total = needs + wants + savings;
  const incomeNum = parseFloat(income) || 0;

  async function save() {
    setError(null);
    if (total !== 100) return setError(`Bucket percentages must total 100 (now ${total}).`);
    try {
      await update.mutateAsync({
        income: incomeNum,
        plan_needs: needs,
        plan_wants: wants,
        plan_savings: savings,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save budget.");
    }
  }

  const rows: { label: string; value: number; set: (n: number) => void; color: string }[] = [
    { label: "Needs", value: needs, set: setNeeds, color: BUCKETS.needs.color },
    { label: "Wants", value: wants, set: setWants, color: BUCKETS.wants.color },
    { label: "Savings", value: savings, set: setSavings, color: BUCKETS.savings.color },
  ];

  return (
    <Sheet title="Budget plan" onClose={onClose}>
      <div className="px-5 py-4 space-y-5">
        <div className="space-y-1.5">
          <Input
            label="Estimated monthly income"
            inputMode="decimal"
            placeholder="0.00"
            value={income}
            onChange={(e) => setIncome(e.target.value)}
          />
          <p className="text-xs" style={{ color: "var(--color-faint)" }}>
            Only sizes the allocation below. The dashboard&apos;s expected income
            comes from your month plan (Profile → Month plan).
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
              Allocation
            </p>
            <span
              className="text-xs font-semibold"
              style={{ color: total === 100 ? "var(--color-positive)" : "var(--color-danger)" }}
            >
              {total}% / 100%
            </span>
          </div>

          {rows.map((r) => (
            <div key={r.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2" style={{ color: "var(--color-text)" }}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: r.color }} />
                  {r.label}
                </span>
                <span style={{ color: "var(--color-muted)" }}>
                  {r.value}% · {fmt0((incomeNum * r.value) / 100)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={r.value}
                onChange={(e) => r.set(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: r.color }}
              />
            </div>
          ))}
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <Button fullWidth onClick={save} disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save budget plan"}
        </Button>
      </div>
    </Sheet>
  );
}
