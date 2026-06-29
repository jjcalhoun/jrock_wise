"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { useCategories, useCategoryBudgets } from "@/hooks/useSupabaseData";
import { CategoryEditor } from "@/components/settings/CategoryEditor";
import { BUCKETS } from "@/lib/buckets";
import { fmt0 } from "@/lib/format";
import type { Category, BucketType } from "@/lib/types";

export function CategoryManager({ onClose }: { onClose: () => void }) {
  const { data: categories = [] } = useCategories();
  const { data: budgets = {} } = useCategoryBudgets();
  const [editing, setEditing] = useState<Category | "new" | null>(null);

  const nextSortOrder =
    categories.reduce((m, c) => Math.max(m, c.sort_order), 0) + 1;

  const buckets = Object.keys(BUCKETS) as BucketType[];

  return (
    <Sheet title="Manage categories" onClose={onClose}>
      <div className="px-5 py-4 space-y-5">
        <Button fullWidth onClick={() => setEditing("new")}>
          + New category
        </Button>

        {buckets.map((b) => {
          const inBucket = categories.filter((c) => c.bucket === b);
          if (inBucket.length === 0) return null;
          return (
            <div key={b} className="space-y-2">
              <p className="text-xs font-semibold flex items-center gap-2" style={{ color: "var(--color-muted)" }}>
                <span className="w-2 h-2 rounded-full" style={{ background: BUCKETS[b].color }} />
                {BUCKETS[b].label}
              </p>
              <div className="space-y-1">
                {inBucket.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setEditing(c)}
                    className="w-full flex items-center justify-between py-2 px-2 rounded-lg text-left"
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className="inline-flex items-center justify-center w-8 h-8 rounded-full"
                        style={{ background: `${c.color}22` }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18, color: c.color }}>
                          {c.icon}
                        </span>
                      </span>
                      <span className="text-sm" style={{ color: "var(--color-text)" }}>
                        {c.name}
                      </span>
                    </span>
                    <span className="text-xs" style={{ color: "var(--color-faint)" }}>
                      {budgets[c.id] ? fmt0(budgets[c.id]) + "/mo" : "no target"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {editing && (
        <CategoryEditor
          category={editing === "new" ? undefined : editing}
          currentTarget={editing === "new" ? 0 : budgets[editing.id] ?? 0}
          nextSortOrder={nextSortOrder}
          onClose={() => setEditing(null)}
        />
      )}
    </Sheet>
  );
}
