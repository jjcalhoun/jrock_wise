"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import {
  useAccounts,
  useSettings,
  useImportTransactions,
} from "@/hooks/useSupabaseData";
import {
  parseCsv,
  detectHeaderRow,
  buildRows,
  type ColumnMap,
} from "@/lib/csv";
import { fmt } from "@/lib/format";

type Step = 1 | 2 | 3 | 4 | 5;

export function ImportWizard({ onClose }: { onClose: () => void }) {
  const { data: accounts = [] } = useAccounts();
  const { data: settings } = useSettings();
  const importTxns = useImportTransactions();

  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<string[][]>([]);
  const [headerIdx, setHeaderIdx] = useState(0);
  const [map, setMap] = useState<ColumnMap>({ date: 0, amount: 1, description: 2 });
  const [accountId, setAccountId] = useState("");
  const [flip, setFlip] = useState(false);
  const [result, setResult] = useState<{ inserted: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importStart = settings?.import_start_date ?? null;
  const header = rows[headerIdx] ?? [];
  const dataRows = rows.slice(headerIdx + 1);
  const { rows: parsed, skipped } = buildRows(dataRows, map, flip);
  const beforeStart = importStart
    ? parsed.filter((r) => r.date < importStart).length
    : 0;
  const toImport = importStart ? parsed.filter((r) => r.date >= importStart) : parsed;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    const grid = parseCsv(text);
    if (grid.length === 0) {
      setError("That file looks empty.");
      return;
    }
    const hi = detectHeaderRow(grid);
    setRows(grid);
    setHeaderIdx(hi);
    // best-guess column mapping from header names
    const hdr = grid[hi].map((c) => c.toLowerCase());
    const find = (...keys: string[]) => {
      const i = hdr.findIndex((c) => keys.some((k) => c.includes(k)));
      return i >= 0 ? i : 0;
    };
    setMap({
      date: find("date"),
      amount: find("amount", "debit"),
      description: find("description", "payee", "memo", "name"),
    });
    setError(null);
    setStep(2);
  }

  async function confirmImport() {
    setError(null);
    if (!accountId) return setError("Choose a destination account.");
    try {
      const res = await importTxns.mutateAsync({
        account_id: accountId,
        rows: toImport,
      });
      setResult(res);
      setStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    }
  }

  return (
    <Sheet title="Import CSV" onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        {/* step indicator */}
        {step < 5 && (
          <p className="text-xs" style={{ color: "var(--color-faint)" }}>
            Step {step} of 4
          </p>
        )}

        {/* STEP 1 — file */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              Choose a CSV exported from your bank. Any format — you'll map the
              columns next.
            </p>
            <label
              className="flex flex-col items-center justify-center gap-2 py-10 rounded-xl border border-dashed cursor-pointer"
              style={{ borderColor: "var(--color-hairline)" }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 32, color: "var(--color-muted)" }}>
                upload_file
              </span>
              <span className="text-sm" style={{ color: "var(--color-text)" }}>
                {fileName || "Choose file"}
              </span>
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
            </label>
          </div>
        )}

        {/* STEP 2 — header row */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              Which row has the column headers? (Some exports put account info on
              top.)
            </p>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {rows.slice(0, 12).map((r, i) => (
                <button
                  key={i}
                  onClick={() => setHeaderIdx(i)}
                  className="w-full text-left px-3 py-2 rounded-lg text-xs font-mono truncate border"
                  style={{
                    background: i === headerIdx ? "var(--color-elevated)" : "var(--color-surface)",
                    borderColor: i === headerIdx ? "var(--color-primary)" : "var(--color-hairline)",
                    color: "var(--color-text)",
                  }}
                >
                  {r.join(" , ")}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
              <Button fullWidth onClick={() => setStep(3)}>Next</Button>
            </div>
          </div>
        )}

        {/* STEP 3 — columns + account */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              Map the columns.
            </p>
            {(["date", "amount", "description"] as const).map((field) => (
              <div key={field}>
                <p className="text-xs font-medium mb-1.5 capitalize" style={{ color: "var(--color-muted)" }}>
                  {field}
                </p>
                <div className="flex flex-wrap gap-2">
                  {header.map((h, i) => (
                    <Chip key={i} active={map[field] === i} onClick={() => setMap({ ...map, [field]: i })}>
                      {h || `Col ${i + 1}`}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}

            <div>
              <p className="text-xs font-medium mb-1.5" style={{ color: "var(--color-muted)" }}>
                Destination account
              </p>
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => (
                  <Chip key={a.id} active={accountId === a.id} onClick={() => setAccountId(a.id)}>
                    {a.name}
                  </Chip>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between">
              <span className="text-sm" style={{ color: "var(--color-text)" }}>
                Flip sign (file shows spending as positive)
              </span>
              <input type="checkbox" checked={flip} onChange={(e) => setFlip(e.target.checked)} style={{ accentColor: "var(--color-primary)" }} />
            </label>

            {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(2)}>Back</Button>
              <Button fullWidth onClick={() => { if (!accountId) { setError("Choose a destination account."); return; } setError(null); setStep(4); }}>
                Preview
              </Button>
            </div>
          </div>
        )}

        {/* STEP 4 — review */}
        {step === 4 && (
          <div className="space-y-4">
            <div
              className="rounded-xl border p-4 space-y-1"
              style={{ background: "var(--color-surface)", borderColor: "var(--color-hairline)" }}
            >
              <Row label="Rows to import" value={String(toImport.length)} strong />
              {beforeStart > 0 && (
                <Row label={`Excluded (before ${importStart})`} value={String(beforeStart)} />
              )}
              {skipped > 0 && <Row label="Skipped (unparseable)" value={String(skipped)} />}
            </div>

            <div className="space-y-1 max-h-56 overflow-y-auto">
              {toImport.slice(0, 8).map((r, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-1.5">
                  <span className="truncate mr-2" style={{ color: "var(--color-text)" }}>
                    {r.description || "—"}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className="font-figure" style={{ color: r.amount < 0 ? "var(--color-text)" : "var(--color-positive)" }}>
                      {fmt(r.amount)}
                    </span>
                    <span style={{ color: "var(--color-faint)" }}>{r.date}</span>
                  </span>
                </div>
              ))}
              {toImport.length > 8 && (
                <p className="text-xs pt-1" style={{ color: "var(--color-faint)" }}>
                  +{toImport.length - 8} more…
                </p>
              )}
            </div>

            {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}

            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setStep(3)}>Back</Button>
              <Button fullWidth onClick={confirmImport} disabled={importTxns.isPending || toImport.length === 0}>
                {importTxns.isPending ? "Importing…" : `Import ${toImport.length}`}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 5 — done */}
        {step === 5 && result && (
          <div className="text-center space-y-3 py-6">
            <span className="material-symbols-outlined" style={{ fontSize: 40, color: "var(--color-positive)" }}>
              check_circle
            </span>
            <p className="font-semibold" style={{ color: "var(--color-text)" }}>
              Imported {result.inserted} transaction{result.inserted === 1 ? "" : "s"}
            </p>
            {result.inserted < result.total && (
              <p className="text-sm" style={{ color: "var(--color-muted)" }}>
                {result.total - result.inserted} were already imported (skipped duplicates).
              </p>
            )}
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              They're waiting in your Review queue on the Activity tab.
            </p>
            <Button onClick={onClose}>Done</Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: "var(--color-muted)" }}>{label}</span>
      <span style={{ color: "var(--color-text)", fontWeight: strong ? 700 : 400 }}>{value}</span>
    </div>
  );
}
