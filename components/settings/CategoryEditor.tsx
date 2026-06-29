"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { BUCKETS } from "@/lib/buckets";
import { ICON_CHOICES, COLOR_CHOICES } from "@/lib/icons";
import {
  useUpsertCategory,
  useArchiveCategory,
  useSetCategoryBudget,
} from "@/hooks/useSupabaseData";
import type { Category, BucketType } from "@/lib/types";

interface Props {
  category?: Category; // present = edit
  currentTarget?: number; // existing monthly budget target
  nextSortOrder: number;
  onClose: () => void;
}

export function CategoryEditor({
  category,
  currentTarget = 0,
  nextSortOrder,
  onClose,
}: Props) {
  const upsert = useUpsertCategory();
  const archive = useArchiveCategory();
  const setBudget = useSetCategoryBudget();

  const [name, setName] = useState(category?.name ?? "");
  const [bucket, setBucket] = useState<BucketType>(category?.bucket ?? "needs");
  const [color, setColor] = useState(category?.color ?? COLOR_CHOICES[0]);
  const [icon, setIcon] = useState(category?.icon ?? ICON_CHOICES[0]);
  const [target, setTarget] = useState(currentTarget ? String(currentTarget) : "");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Give the category a name.");
    try {
      await upsert.mutateAsync({
        id: category?.id,
        name: name.trim(),
        bucket,
        color,
        icon,
        sort_order: category?.sort_order ?? nextSortOrder,
      });
      // monthly target (best-effort; needs the category id, which exists on edit)
      const num = parseFloat(target);
      if (category?.id && !isNaN(num)) {
        await setBudget.mutateAsync({ category_id: category.id, monthly_target: num });
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save category.");
    }
  }

  async function remove() {
    if (!category) return;
    if (!confirm(`Archive "${category.name}"? Past transactions keep their history.`))
      return;
    try {
      await archive.mutateAsync(category.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not archive category.");
    }
  }

  return (
    <Sheet title={category ? "Edit category" : "New category"} onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        {/* preview + name */}
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center justify-center w-11 h-11 rounded-full shrink-0"
            style={{ background: `${color}22` }}
          >
            <span className="material-symbols-outlined" style={{ color }}>
              {icon}
            </span>
          </span>
          <div className="flex-1">
            <Input
              placeholder="Category name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>

        {/* bucket */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
            Bucket
          </p>
          <div className="flex gap-2">
            {(Object.keys(BUCKETS) as BucketType[]).map((b) => (
              <Chip key={b} active={bucket === b} color={BUCKETS[b].color} onClick={() => setBucket(b)}>
                {BUCKETS[b].label}
              </Chip>
            ))}
          </div>
        </div>

        {/* monthly target */}
        <Input
          label="Monthly budget target"
          inputMode="decimal"
          placeholder="0.00"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        {!category && (
          <p className="text-xs -mt-2" style={{ color: "var(--color-faint)" }}>
            Save first, then reopen to set a budget target.
          </p>
        )}

        {/* color */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
            Color
          </p>
          <div className="flex flex-wrap gap-2">
            {COLOR_CHOICES.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-7 h-7 rounded-full"
                style={{
                  background: c,
                  outline: color === c ? "2px solid var(--color-text)" : "none",
                  outlineOffset: 2,
                }}
                aria-label={`Color ${c}`}
              />
            ))}
          </div>
        </div>

        {/* icon */}
        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
            Icon
          </p>
          <div className="grid grid-cols-7 gap-2 max-h-44 overflow-y-auto">
            {ICON_CHOICES.map((ic) => (
              <button
                key={ic}
                onClick={() => setIcon(ic)}
                className="flex items-center justify-center h-10 rounded-lg"
                style={{
                  background: icon === ic ? `${color}22` : "var(--color-surface)",
                  outline: icon === ic ? `2px solid ${color}` : "1px solid var(--color-hairline)",
                }}
              >
                <span
                  className="material-symbols-outlined"
                  style={{ fontSize: 20, color: icon === ic ? color : "var(--color-muted)" }}
                >
                  {ic}
                </span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-1">
          {category && (
            <Button variant="ghost" onClick={remove} disabled={archive.isPending}>
              Archive
            </Button>
          )}
          <Button fullWidth onClick={save} disabled={upsert.isPending}>
            {upsert.isPending ? "Saving…" : category ? "Save" : "Add category"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
