"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useTheme } from "@/components/providers";
import { useAccounts, useTransactions } from "@/hooks/useSupabaseData";
import { allBalances } from "@/lib/aggregations";
import { fmt } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { AccountEditor } from "@/components/settings/AccountEditor";
import { BudgetEditor } from "@/components/settings/BudgetEditor";
import { CategoryManager } from "@/components/settings/CategoryManager";
import { ImportWizard } from "@/components/import/ImportWizard";
import type { Account, ThemeMode } from "@/lib/types";

type Sheet = "budget" | "categories" | "import" | null;

export function ProfileScreen() {
  const router = useRouter();
  const { themeMode, setThemeMode } = useTheme();
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();

  const [editingAccount, setEditingAccount] = useState<Account | "new" | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);

  const balances = allBalances(accounts, transactions);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="p-4 space-y-5">
      <h1 className="font-figure text-xl font-bold" style={{ color: "var(--color-text)" }}>
        Profile
      </h1>

      {/* Accounts */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
            Accounts
          </h2>
          <button
            className="text-xs font-semibold"
            style={{ color: "var(--color-primary)" }}
            onClick={() => setEditingAccount("new")}
          >
            + Add
          </button>
        </div>
        {accounts.length === 0 ? (
          <Card className="p-4 text-center">
            <p className="text-sm" style={{ color: "var(--color-muted)" }}>
              No accounts yet.
            </p>
          </Card>
        ) : (
          <Card className="divide-y" style={{ borderColor: "var(--color-hairline)" }}>
            {accounts.map((a) => (
              <button
                key={a.id}
                onClick={() => setEditingAccount(a)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
                    {a.name}
                  </p>
                  <p className="text-xs capitalize" style={{ color: "var(--color-faint)" }}>
                    {a.type}{a.last4 ? ` ••${a.last4}` : ""}
                  </p>
                </div>
                <span
                  className="font-figure text-sm font-semibold"
                  style={{ color: (balances[a.id] ?? 0) < 0 ? "var(--color-danger)" : "var(--color-text)" }}
                >
                  {fmt(balances[a.id] ?? 0)}
                </span>
              </button>
            ))}
          </Card>
        )}
      </section>

      {/* Settings */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Settings
        </h2>
        <Card className="divide-y" style={{ borderColor: "var(--color-hairline)" }}>
          <SettingRow icon="tune" label="Budget plan" onClick={() => setSheet("budget")} />
          <SettingRow icon="category" label="Manage categories" onClick={() => setSheet("categories")} />
          <SettingRow icon="upload_file" label="Import CSV" onClick={() => setSheet("import")} />
        </Card>
      </section>

      {/* Theme */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Theme
        </h2>
        <div className="flex gap-2">
          {(["system", "light", "dark"] as ThemeMode[]).map((m) => (
            <Chip key={m} active={themeMode === m} onClick={() => setThemeMode(m)}>
              {m === "system" ? "Device" : m === "light" ? "Light" : "Dark"}
            </Chip>
          ))}
        </div>
      </section>

      <Button variant="secondary" fullWidth onClick={signOut}>
        Sign out
      </Button>

      {editingAccount && (
        <AccountEditor
          account={editingAccount === "new" ? undefined : editingAccount}
          onClose={() => setEditingAccount(null)}
        />
      )}
      {sheet === "budget" && <BudgetEditor onClose={() => setSheet(null)} />}
      {sheet === "categories" && <CategoryManager onClose={() => setSheet(null)} />}
      {sheet === "import" && <ImportWizard onClose={() => setSheet(null)} />}
    </main>
  );
}

function SettingRow({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between px-4 py-3 text-left">
      <span className="flex items-center gap-3">
        <span className="material-symbols-outlined" style={{ fontSize: 20, color: "var(--color-muted)" }}>
          {icon}
        </span>
        <span className="text-sm" style={{ color: "var(--color-text)" }}>
          {label}
        </span>
      </span>
      <span className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-faint)" }}>
        chevron_right
      </span>
    </button>
  );
}
