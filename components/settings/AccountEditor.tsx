"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ACCOUNT_TYPES, LIABILITY_TYPES } from "@/lib/buckets";
import {
  useUpsertAccount,
  useDeleteAccount,
  type AccountInput,
} from "@/hooks/useSupabaseData";
import { useSimplefinMappings } from "@/hooks/useSimplefin";
import { fmt } from "@/lib/format";
import type { Account } from "@/lib/types";

interface Props {
  account?: Account; // present = edit
  onClose: () => void;
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export function AccountEditor({ account, onClose }: Props) {
  const upsert = useUpsertAccount();
  const del = useDeleteAccount();
  const { data: mappings = [] } = useSimplefinMappings();
  const linked = !!account && mappings.some((m) => m.account_id === account.id);

  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<Account["type"]>(account?.type ?? "checking");
  const [last4, setLast4] = useState(account?.last4 ?? "");
  const [balance, setBalance] = useState(
    account ? String(account.starting_balance) : "",
  );
  const [asOf, setAsOf] = useState(account?.as_of_date ?? todayISO());
  const [apr, setApr] = useState(account ? String(account.apr) : "0");
  const [error, setError] = useState<string | null>(null);

  const isLiability = LIABILITY_TYPES.includes(type);

  async function save() {
    setError(null);
    if (!name.trim()) return setError("Give the account a name.");
    const num = parseFloat(balance);
    if (isNaN(num)) return setError("Enter a starting balance (can be 0).");

    // Liabilities are stored as negative (amount owed).
    const signed = isLiability ? -Math.abs(num) : num;

    const input: AccountInput & { id?: string } = {
      id: account?.id,
      name: name.trim(),
      type,
      last4: last4.trim() || null,
      starting_balance: signed,
      as_of_date: asOf,
      apr: parseFloat(apr) || 0,
    };
    try {
      await upsert.mutateAsync(input);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save account.");
    }
  }

  async function remove() {
    if (!account) return;
    if (!confirm(`Delete "${account.name}" and all its transactions?`)) return;
    try {
      await del.mutateAsync(account.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete account.");
    }
  }

  return (
    <Sheet title={account ? "Edit account" : "New account"} onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <Input
          label="Name"
          placeholder="e.g. Chase Checking"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <div>
          <p className="text-xs font-medium mb-2" style={{ color: "var(--color-muted)" }}>
            Type
          </p>
          <div className="flex flex-wrap gap-2">
            {ACCOUNT_TYPES.map((t) => (
              <Chip
                key={t.value}
                active={type === t.value}
                onClick={() => setType(t.value)}
              >
                {t.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              label={linked ? "Current balance" : isLiability ? "Amount owed" : "Starting balance"}
              placeholder="0.00"
              inputMode="decimal"
              value={
                linked
                  ? fmt(account?.live_balance ?? account?.starting_balance ?? 0)
                  : balance
              }
              onChange={(e) => setBalance(e.target.value)}
              disabled={linked}
              style={linked ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
            />
          </div>
          <div className="w-28">
            <Input
              label="Last 4"
              placeholder="1234"
              inputMode="numeric"
              maxLength={4}
              value={last4 ?? ""}
              onChange={(e) => setLast4(e.target.value)}
            />
          </div>
        </div>
        {linked && (
          <p className="text-xs -mt-2 flex items-center gap-1" style={{ color: "var(--color-faint)" }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>sync</span>
            Balance is updated automatically via SimpleFIN sync.
          </p>
        )}

        <Input
          label="Balance as of"
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
        <p className="text-xs -mt-2" style={{ color: "var(--color-faint)" }}>
          Only transactions dated after this count toward the balance.
        </p>

        {isLiability && (
          <Input
            label="APR (%)"
            placeholder="0"
            inputMode="decimal"
            value={apr}
            onChange={(e) => setApr(e.target.value)}
          />
        )}

        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-3 pt-2">
          {account && (
            <Button variant="ghost" onClick={remove} disabled={del.isPending}>
              Delete
            </Button>
          )}
          <Button
            fullWidth
            onClick={save}
            disabled={upsert.isPending}
          >
            {upsert.isPending ? "Saving…" : account ? "Save" : "Add account"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
