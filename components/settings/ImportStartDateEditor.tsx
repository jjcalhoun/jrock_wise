"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useSettings, useUpdateSettings } from "@/hooks/useSupabaseData";

export function ImportStartDateEditor({ onClose }: { onClose: () => void }) {
  const { data: settings } = useSettings();
  const update = useUpdateSettings();
  const [date, setDate] = useState(settings?.import_start_date ?? "");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await update.mutateAsync({ import_start_date: date || null });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <Sheet title="Import start date" onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          When importing CSVs, transactions dated before this are skipped. Set it
          earlier to pull in more history, or clear it to import everything.
        </p>
        <Input
          label="Start date"
          type="date"
          value={date ?? ""}
          onChange={(e) => setDate(e.target.value)}
        />
        {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
        <div className="flex gap-3">
          <Button variant="ghost" onClick={() => setDate("")}>
            Clear
          </Button>
          <Button fullWidth onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
