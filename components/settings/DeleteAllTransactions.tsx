"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { useTransactions, useDeleteAllTransactions } from "@/hooks/useSupabaseData";

export function DeleteAllTransactions({ onClose }: { onClose: () => void }) {
  const { data: transactions = [] } = useTransactions();
  const deleteAll = useDeleteAllTransactions();
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      await deleteAll.mutateAsync();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  return (
    <Sheet title="Delete all transactions" onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        {done ? (
          <div className="text-center space-y-3 py-6">
            <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--color-positive)" }}>
              check_circle
            </span>
            <p className="font-semibold" style={{ color: "var(--color-text)" }}>
              All transactions deleted.
            </p>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              Re-sync from Bank connections to pull them back in cleanly.
            </p>
            <Button onClick={onClose}>Done</Button>
          </div>
        ) : (
          <>
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              This permanently deletes <strong style={{ color: "var(--color-text)" }}>all {transactions.length} transaction{transactions.length === 1 ? "" : "s"}</strong> (and their category splits) for every account. Your accounts, categories, and budgets are kept. This can't be undone.
            </p>
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-muted)" }}>
                Type <span className="font-mono">DELETE</span> to confirm
              </p>
              <input
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="DELETE"
                className="w-full px-3 py-2 rounded-lg text-sm font-mono outline-none border"
                style={{
                  background: "var(--color-elevated)",
                  color: "var(--color-text)",
                  borderColor: "var(--color-hairline)",
                }}
              />
            </div>
            {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
            <Button
              fullWidth
              onClick={run}
              disabled={confirm !== "DELETE" || deleteAll.isPending}
              style={{ background: "var(--color-danger)", color: "#fff" }}
            >
              {deleteAll.isPending ? "Deleting…" : "Delete everything"}
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
