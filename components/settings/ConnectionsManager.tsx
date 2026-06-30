"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { useAccounts, useSettings, useUpdateSettings } from "@/hooks/useSupabaseData";
import {
  useSimplefinConnections,
  useSimplefinMappings,
  useClaimSetupToken,
  useConnectionAccounts,
  useMapAccounts,
  useSyncSimplefin,
  useDisconnectSimplefin,
  type ClaimedAccount,
} from "@/hooks/useSimplefin";

function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ConnectionsManager({ onClose }: { onClose: () => void }) {
  const { data: accounts = [] } = useAccounts();
  const { data: settings } = useSettings();
  const { data: connections = [] } = useSimplefinConnections();
  const { data: mappings = [] } = useSimplefinMappings();
  const updateSettings = useUpdateSettings();
  const claim = useClaimSetupToken();
  const connectionAccounts = useConnectionAccounts();
  const mapAccounts = useMapAccounts();
  const sync = useSyncSimplefin();
  const disconnect = useDisconnectSimplefin();

  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Mapping sub-view state, populated after a successful claim.
  const [claimed, setClaimed] = useState<{
    connectionId: string;
    accounts: ClaimedAccount[];
  } | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});

  const autocat = settings?.autocategorize_imports ?? true;

  async function onConnect() {
    setError(null);
    setNote(null);
    if (!token.trim()) return setError("Paste your SimpleFIN setup token.");
    try {
      const res = await claim.mutateAsync(token.trim());
      setToken("");
      setClaimed(res);
      setPicks({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    }
  }

  async function onSaveMapping() {
    if (!claimed) return;
    setError(null);
    const mappingsToSave = claimed.accounts
      .filter((a) => picks[a.simplefin_account_id])
      .map((a) => ({
        simplefin_account_id: a.simplefin_account_id,
        account_id: picks[a.simplefin_account_id],
        org_name: a.org_name,
      }));
    if (mappingsToSave.length === 0) {
      return setError("Link at least one account, or close to do it later.");
    }
    try {
      await mapAccounts.mutateAsync({
        connectionId: claimed.connectionId,
        mappings: mappingsToSave,
      });
      // Pull transactions right away for the freshly mapped accounts.
      const res = await sync.mutateAsync(claimed.connectionId);
      setClaimed(null);
      setNote(`Synced — imported ${res.inserted} transaction${res.inserted === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save mapping.");
    }
  }

  async function onLinkExisting(connectionId: string) {
    setError(null);
    setNote(null);
    try {
      const res = await connectionAccounts.mutateAsync(connectionId);
      setClaimed(res);
      setPicks({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load accounts.");
    }
  }

  async function onSync(connectionId?: string) {
    setError(null);
    setNote(null);
    try {
      const res = await sync.mutateAsync(connectionId);
      const errs = res.errors.length ? ` (${res.errors.length} warning${res.errors.length === 1 ? "" : "s"})` : "";
      setNote(`Synced — ${res.inserted} new, ${res.balancesUpdated} balance${res.balancesUpdated === 1 ? "" : "s"} updated.${errs}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed.");
    }
  }

  // ---- Mapping sub-view ----
  if (claimed) {
    return (
      <Sheet title="Link accounts" onClose={() => setClaimed(null)}>
        <div className="px-5 py-4 space-y-4">
          <p className="text-sm" style={{ color: "var(--color-muted)" }}>
            Match each bank account to one of yours. Skip any you don't want to track.
          </p>
          {accounts.length === 0 && (
            <p className="text-xs" style={{ color: "var(--color-danger)" }}>
              You have no accounts yet — add one in Accounts first, then come back.
            </p>
          )}
          {claimed.accounts.map((a) => (
            <div key={a.simplefin_account_id} className="space-y-1.5">
              <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                {a.org_name} · {a.name}
                <span className="ml-2 font-figure text-xs" style={{ color: "var(--color-faint)" }}>
                  bal {a.balance}
                </span>
              </p>
              <div className="flex flex-wrap gap-2">
                {accounts.map((acct) => (
                  <Chip
                    key={acct.id}
                    active={picks[a.simplefin_account_id] === acct.id}
                    onClick={() =>
                      setPicks((p) => ({
                        ...p,
                        [a.simplefin_account_id]:
                          p[a.simplefin_account_id] === acct.id ? "" : acct.id,
                      }))
                    }
                  >
                    {acct.name}
                  </Chip>
                ))}
              </div>
            </div>
          ))}

          {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}

          <Button
            fullWidth
            onClick={onSaveMapping}
            disabled={mapAccounts.isPending || sync.isPending}
          >
            {mapAccounts.isPending || sync.isPending ? "Saving…" : "Link & sync"}
          </Button>
        </div>
      </Sheet>
    );
  }

  // ---- Home view ----
  return (
    <Sheet title="Bank connections" onClose={onClose}>
      <div className="px-5 py-4 space-y-5">
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Connect a bank through SimpleFIN to pull balances and transactions
          automatically. Generate a setup token at{" "}
          <a
            href="https://beta-bridge.simplefin.org"
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--color-primary)" }}
          >
            SimpleFIN Bridge
          </a>{" "}
          → New app connection.
        </p>

        {/* Existing connections */}
        {connections.length > 0 && (
          <div className="space-y-2">
            {connections.map((c) => {
              const linked = mappings.filter((m) => m.connection_id === c.id);
              return (
                <div
                  key={c.id}
                  className="rounded-xl border p-3 space-y-2"
                  style={{ background: "var(--color-surface)", borderColor: "var(--color-hairline)" }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                        {linked.length > 0
                          ? linked.map((m) => m.org_name ?? "Bank").join(", ")
                          : "Connected (no accounts linked)"}
                      </p>
                      <p className="text-xs" style={{ color: "var(--color-faint)" }}>
                        {linked.length} account{linked.length === 1 ? "" : "s"} · synced {timeAgo(c.last_synced_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => disconnect.mutate(c.id)}
                      className="text-xs"
                      style={{ color: "var(--color-danger)" }}
                    >
                      Disconnect
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      fullWidth
                      onClick={() => onLinkExisting(c.id)}
                      disabled={connectionAccounts.isPending}
                    >
                      {connectionAccounts.isPending ? "Loading…" : linked.length > 0 ? "Edit links" : "Link accounts"}
                    </Button>
                    <Button
                      variant="secondary"
                      fullWidth
                      onClick={() => onSync(c.id)}
                      disabled={sync.isPending}
                    >
                      {sync.isPending ? "Syncing…" : "Sync now"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Auto-categorize toggle */}
        {connections.length > 0 && (
          <label className="flex items-center justify-between">
            <span className="text-sm" style={{ color: "var(--color-text)" }}>
              Best-guess category on import
            </span>
            <input
              type="checkbox"
              checked={autocat}
              onChange={(e) =>
                updateSettings.mutate({ autocategorize_imports: e.target.checked })
              }
              style={{ accentColor: "var(--color-primary)" }}
            />
          </label>
        )}

        {/* Connect (new) */}
        <div className="space-y-2">
          <p className="text-xs font-medium" style={{ color: "var(--color-muted)" }}>
            {connections.length > 0 ? "Connect another bank" : "Setup token"}
          </p>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste setup token…"
            rows={3}
            className="w-full px-3 py-2 rounded-lg text-xs font-mono outline-none border resize-none"
            style={{
              background: "var(--color-elevated)",
              color: "var(--color-text)",
              borderColor: "var(--color-hairline)",
            }}
          />
          <Button fullWidth onClick={onConnect} disabled={claim.isPending}>
            {claim.isPending ? "Connecting…" : "Connect"}
          </Button>
        </div>

        {error && <p className="text-sm" style={{ color: "var(--color-danger)" }}>{error}</p>}
        {note && <p className="text-sm" style={{ color: "var(--color-positive)" }}>{note}</p>}
      </div>
    </Sheet>
  );
}
