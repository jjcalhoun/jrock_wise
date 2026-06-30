"use client";

import type { Category } from "@/lib/types";

interface Props {
  categories: Category[];
  selectedId?: string;
  onPick: (category: Category) => void;
}

/** The 4-column icon grid of categories. Reused inline (Review) and in the
 *  CategoryPicker sheet. */
export function CategoryGrid({ categories, selectedId, onPick }: Props) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {categories.map((c) => {
        const active = c.id === selectedId;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c)}
            className="flex flex-col items-center gap-1.5"
          >
            <span
              className="flex items-center justify-center w-full aspect-square rounded-2xl"
              style={{
                background: "var(--color-surface)",
                outline: active ? `2px solid ${c.color}` : "1px solid var(--color-hairline)",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 26, color: c.color }}>
                {c.icon}
              </span>
            </span>
            <span
              className="text-[11px] text-center leading-tight"
              style={{ color: active ? "var(--color-text)" : "var(--color-muted)" }}
            >
              {c.name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
