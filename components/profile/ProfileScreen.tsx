"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import {
  useAccounts,
  useBudget,
  useUpdateBudget,
} from "@/hooks/useSupabaseData";
import { allBalances } from "@/lib/aggregations";
import { useTransactions } from "@/hooks/useSupabaseData";
import { fmt } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { AccountEditor } from "@/components/settings/AccountEditor";
import type { Account } from "@/lib/types";

export function ProfileScreen() {
  const router = useRouter();
  const { data: accounts = [] } = useAccounts();
  const { data: transactions = [] } = useTransactions();
  const { data: budget } = useBudget();
  const updateBudget = useUpdateBudget();

  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [income, setIncome] = useState<string>("");
  const [incomeSaved, setIncomeSaved] = useState(false);

  const balances = allBalances(accounts, transactions);

  async function saveIncome() {
    const num = parseFloat(income);
    if (isNaN(num)) return;
    await updateBudget.mutateAsync({ income: num });
    setIncomeSaved(true);
    setTimeout(() => setIncomeSaved(false), 2000);
  }

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
            onClick={() => setEditing("new")}
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
                onClick={() => setEditing(a)}
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
                  style={{
                    color: (balances[a.id] ?? 0) < 0 ? "var(--color-danger)" : "var(--color-text)",
                  }}
                >
                  {fmt(balances[a.id] ?? 0)}
                </span>
              </button>
            ))}
          </Card>
        )}
      </section>

      {/* Estimated income */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          Estimated monthly income
        </h2>
        <Card className="p-4 space-y-3">
          <Input
            inputMode="decimal"
            placeholder={budget ? String(budget.income) : "0.00"}
            value={income}
            onChange={(e) => setIncome(e.target.value)}
          />
          <Button onClick={saveIncome} disabled={updateBudget.isPending}>
            {incomeSaved ? "Saved ✓" : updateBudget.isPending ? "Saving…" : "Save income"}
          </Button>
        </Card>
      </section>

      {/* Sign out */}
      <Button variant="secondary" fullWidth onClick={signOut}>
        Sign out
      </Button>

      {editing && (
        <AccountEditor
          account={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </main>
  );
}
