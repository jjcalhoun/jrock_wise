"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { useCategories } from "@/hooks/useSupabaseData";
import type { Category } from "@/lib/types";

/** A tappable field that shows the chosen category and opens the picker. */
export function CategoryField({
  category,
  onOpen,
}: {
  category?: Category;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center justify-between px-4 py-3 rounded-xl border"
      style={{ background: "var(--color-elevated)", borderColor: "var(--color-hairline)" }}
    >
      <span className="flex items-center gap-3">
        {category ? (
          <>
            <span
              className="inline-flex items-center justify-center w-7 h-7 rounded-full"
              style={{ background: `${category.color}22` }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: category.color }}>
                {category.icon}
              </span>
            </span>
            <span className="text-sm" style={{ color: "var(--color-text)" }}>
              {category.name}
            </span>
          </>
        ) : (
          <span className="text-sm" style={{ color: "var(--color-faint)" }}>
            Choose category
          </span>
        )}
      </span>
      <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-faint)" }}>
        chevron_right
      </span>
    </button>
  );
}

interface Props {
  selectedId?: string;
  onPick: (category: Category) => void;
  onClose: () => void;
}

export function CategoryPicker({ selectedId, onPick, onClose }: Props) {
  const { data: categories = [] } = useCategories();
  const [query, setQuery] = useState("");

  const filtered = query
    ? categories.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : categories;

  return (
    <Sheet title="Choose Category" onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl border"
          style={{ background: "var(--color-surface)", borderColor: "var(--color-hairline)" }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-faint)" }}>
            search
          </span>
          <input
            autoFocus
            placeholder="Search categories"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="bg-transparent outline-none text-sm flex-1"
            style={{ color: "var(--color-text)" }}
          />
        </div>

        <div className="grid grid-cols-4 gap-3">
          {filtered.map((c) => {
            const active = c.id === selectedId;
            return (
              <button
                key={c.id}
                onClick={() => {
                  onPick(c);
                  onClose();
                }}
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
      </div>
    </Sheet>
  );
}
