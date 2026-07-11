"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Chip } from "@/components/ui/Chip";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import type { Category, TransactionType } from "@/lib/types";

export interface ActivityFilters {
  type: TransactionType | "all";
  recurring: "all" | "recurring" | "other"; // rule-generated or plan-linked vs the rest
  categoryId: string | null;
  year: number | null;
  month: number | null; // 1-12
  from: string; // ISO date or ""
  to: string; // ISO date or ""
}

export const EMPTY_FILTERS: ActivityFilters = {
  type: "all",
  recurring: "all",
  categoryId: null,
  year: null,
  month: null,
  from: "",
  to: "",
};

export function activeFilterCount(f: ActivityFilters): number {
  let n = 0;
  if (f.type !== "all") n++;
  if (f.recurring !== "all") n++;
  if (f.categoryId) n++;
  if (f.year) n++;
  if (f.month) n++;
  if (f.from) n++;
  if (f.to) n++;
  return n;
}

const TYPES: (TransactionType | "all")[] = ["all", "expense", "income", "transfer", "refund"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Props {
  filters: ActivityFilters;
  categories: Category[];
  years: number[];
  onApply: (f: ActivityFilters) => void;
  onClose: () => void;
}

export function FilterSheet({ filters, categories, years, onApply, onClose }: Props) {
  const [f, setF] = useState<ActivityFilters>(filters);
  const set = (patch: Partial<ActivityFilters>) => setF({ ...f, ...patch });

  return (
    <Sheet title="Filters" onClose={onClose}>
      <div className="px-5 py-4 space-y-5">
        {/* type */}
        <Section label="Type">
          <div className="flex flex-wrap gap-2">
            {TYPES.map((t) => (
              <Chip key={t} active={f.type === t} onClick={() => set({ type: t })}>
                {t === "all" ? "All" : t[0].toUpperCase() + t.slice(1)}
              </Chip>
            ))}
          </div>
        </Section>

        {/* recurring */}
        <Section label="Recurring">
          <div className="flex flex-wrap gap-2">
            <Chip active={f.recurring === "all"} onClick={() => set({ recurring: "all" })}>All</Chip>
            <Chip active={f.recurring === "recurring"} onClick={() => set({ recurring: "recurring" })}>
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>repeat</span>
              Recurring only
            </Chip>
            <Chip active={f.recurring === "other"} onClick={() => set({ recurring: "other" })}>
              Not recurring
            </Chip>
          </div>
        </Section>

        {/* category */}
        <Section label="Category">
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            <Chip active={!f.categoryId} onClick={() => set({ categoryId: null })}>
              All
            </Chip>
            {categories.map((c) => (
              <Chip
                key={c.id}
                active={f.categoryId === c.id}
                color={c.color}
                onClick={() => set({ categoryId: f.categoryId === c.id ? null : c.id })}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{c.icon}</span>
                {c.name}
              </Chip>
            ))}
          </div>
        </Section>

        {/* year */}
        {years.length > 0 && (
          <Section label="Year">
            <div className="flex flex-wrap gap-2">
              <Chip active={!f.year} onClick={() => set({ year: null })}>All</Chip>
              {years.map((y) => (
                <Chip key={y} active={f.year === y} onClick={() => set({ year: f.year === y ? null : y })}>
                  {y}
                </Chip>
              ))}
            </div>
          </Section>
        )}

        {/* month */}
        <Section label="Month">
          <div className="flex flex-wrap gap-2">
            {MONTHS.map((m, i) => (
              <Chip
                key={m}
                active={f.month === i + 1}
                onClick={() => set({ month: f.month === i + 1 ? null : i + 1 })}
              >
                {m}
              </Chip>
            ))}
          </div>
        </Section>

        {/* date range */}
        <Section label="Date range">
          <div className="flex gap-3">
            <div className="flex-1">
              <Input label="From" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
            </div>
            <div className="flex-1">
              <Input label="To" type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} />
            </div>
          </div>
        </Section>

        <div className="flex gap-3 pt-1">
          <Button variant="ghost" onClick={() => setF(EMPTY_FILTERS)}>
            Clear
          </Button>
          <Button fullWidth onClick={() => { onApply(f); onClose(); }}>
            Apply
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
        {label}
      </p>
      {children}
    </div>
  );
}
