"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import {
  useMonthPlan,
  useCreatePlanDraft,
  usePopulatePlanItems,
  useAppendPlanItems,
  useConfirmPlan,
  useUpdatePlanItem,
  useAddPlanItem,
  useDeletePlanItem,
} from "@/hooks/useMonthPlan";
import { useRecurringRules } from "@/hooks/useRecurring";
import { useAccounts, useTransactions } from "@/hooks/useSupabaseData";
import { buildPlanDraft } from "@/lib/monthPlan";
import { todayISO } from "@/lib/dates";
import { fmt, fmt0, monthLabel } from "@/lib/format";
import type { MonthPlanItem, PlanItemKind } from "@/lib/types";

/* The month plan — expected income and committed payments, drafted from the
   recurring rules and confirmed/edited by the user. The ledger behind
   "Free to spend" runs on these items. */

const KIND_ORDER: PlanItemKind[] = ["income", "bill", "debt", "cc_payment", "savings"];
const KIND_LABEL: Record<PlanItemKind, string> = {
  income: "Expected income",
  bill: "Bills & subscriptions",
  debt: "Debt payments",
  cc_payment: "Credit-card payments",
  savings: "Savings",
};

export function MonthPlanSheet({ month, onClose }: { month: string; onClose: () => void }) {
  const { data, isLoading } = useMonthPlan(month);
  const { data: rules = [], isLoading: lr } = useRecurringRules();
  const { data: accounts = [], isLoading: la } = useAccounts();
  const { data: transactions = [], isLoading: lt } = useTransactions();
  const createDraft = useCreatePlanDraft();
  const populate = usePopulatePlanItems();
  const append = useAppendPlanItems();
  const confirm = useConfirmPlan(month);
  const update = useUpdatePlanItem(month);
  const add = useAddPlanItem(month);
  const del = useDeletePlanItem(month);
  const [adding, setAdding] = useState(false);
  const drafted = useRef(false);

  // Draft the plan from the rules — but only once every source query has
  // loaded, otherwise we'd snapshot an empty rule list and create a bare plan.
  const sourcesReady = !lr && !la && !lt;
  useEffect(() => {
    if (isLoading || !sourcesReady || drafted.current) return;
    const draft = buildPlanDraft(rules, month, accounts, transactions);
    if (!data?.plan) {
      drafted.current = true;
      createDraft.mutate({ month, draft });
    } else if (
      // Self-heal: an unconfirmed plan with no items (created before the rules
      // had loaded) gets populated in place.
      !data.plan.confirmed_at &&
      data.items.length === 0 &&
      draft.length > 0
    ) {
      drafted.current = true;
      populate.mutate({ month, planId: data.plan.id, draft });
    } else {
      // Rules created after the plan was drafted: append their remaining
      // occurrences (rules with no line in this plan, future dates only).
      const known = new Set(data.items.map((i) => i.rule_id).filter(Boolean));
      const today = todayISO();
      const missing = draft.filter((d) => !known.has(d.rule_id) && d.due_date > today);
      if (missing.length > 0) {
        drafted.current = true;
        append.mutate({ month, planId: data.plan.id, draft: missing });
      }
    }
  }, [isLoading, sourcesReady, data, createDraft, populate, append, month, rules, accounts, transactions]);

  const plan = data?.plan ?? null;
  const items = data?.items ?? [];

  const included = items.filter((i) => !i.excluded);
  const expectedIncome = included.filter((i) => i.kind === "income").reduce((s, i) => s + i.amount, 0);
  const committed = included.filter((i) => i.kind !== "income").reduce((s, i) => s - i.amount, 0);
  const baseline = expectedIncome - committed;

  const groups = KIND_ORDER.map((kind) => ({
    kind,
    items: items.filter((i) => i.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <Sheet title={`${monthLabel(month)} plan`} onClose={onClose}>
      <div className="px-5 py-4 space-y-4">
        <p className="text-sm" style={{ color: "var(--color-muted)" }}>
          Your expected income and committed payments this month. Free to spend
          starts from this baseline; uncheck anything that doesn&apos;t apply this
          month, and tap an amount to adjust it.
        </p>

        {(isLoading || !sourcesReady || createDraft.isPending || populate.isPending) && (
          <p className="text-sm text-center py-4" style={{ color: "var(--color-faint)" }}>
            Drafting from your recurring rules…
          </p>
        )}

        {groups.map((g) => (
          <div key={g.kind} className="space-y-2">
            <p className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
              {KIND_LABEL[g.kind]}
            </p>
            <Card className="divide-y" style={{ borderColor: "var(--color-hairline)" }}>
              {g.items.map((i) => (
                <ItemRow
                  key={i.id}
                  item={i}
                  onToggle={() => update.mutate({ id: i.id, excluded: !i.excluded })}
                  onAmount={(amount) => update.mutate({ id: i.id, amount })}
                  onDelete={i.rule_id ? undefined : () => del.mutate(i.id)}
                />
              ))}
            </Card>
          </div>
        ))}

        {plan && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="w-full text-xs font-semibold py-1"
            style={{ color: "var(--color-primary)" }}
          >
            + Add a one-off line
          </button>
        )}
        {plan && adding && (
          <AddItemForm
            onAdd={(name, kind, amount) => {
              add.mutate({ plan_id: plan.id, name, kind, amount });
              setAdding(false);
            }}
            onCancel={() => setAdding(false)}
          />
        )}

        {/* Summary */}
        <Card className="p-4 space-y-1.5">
          <SummaryRow label="Expected income" value={fmt0(expectedIncome)} />
          <SummaryRow label="Committed payments" value={`−${fmt0(committed)}`} />
          <div className="pt-1.5" style={{ borderTop: "1px solid var(--color-hairline)" }}>
            <SummaryRow
              label="Baseline free to spend"
              value={fmt0(baseline)}
              accent={baseline >= 0 ? "var(--color-positive)" : "var(--color-danger)"}
              bold
            />
          </div>
        </Card>

        {plan && !plan.confirmed_at ? (
          <Button fullWidth onClick={() => confirm.mutate(plan.id)} disabled={confirm.isPending}>
            {confirm.isPending ? "Confirming…" : `Confirm ${monthLabel(month)} plan`}
          </Button>
        ) : plan ? (
          <p className="text-xs text-center" style={{ color: "var(--color-faint)" }}>
            Confirmed — edits apply immediately.
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function ItemRow({
  item,
  onToggle,
  onAmount,
  onDelete,
}: {
  item: MonthPlanItem;
  onToggle: () => void;
  onAmount: (amount: number) => void;
  onDelete?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");

  function commit() {
    const mag = Math.abs(parseFloat(val));
    setEditing(false);
    if (isNaN(mag) || mag === 0) return;
    onAmount(item.kind === "income" ? mag : -mag);
  }

  const day = item.due_date ? new Date(`${item.due_date}T00:00:00`).getDate() : null;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5" style={{ opacity: item.excluded ? 0.45 : 1 }}>
      <input
        type="checkbox"
        checked={!item.excluded}
        onChange={onToggle}
        style={{ accentColor: "var(--color-primary)" }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate" style={{ color: "var(--color-text)" }}>
          {item.name}
        </p>
        <p className="text-xs" style={{ color: "var(--color-faint)" }}>
          {day ? `Day ${day}` : "This month"}
          {item.variable ? " · varies" : ""}
        </p>
      </div>
      {editing ? (
        <input
          autoFocus
          inputMode="decimal"
          defaultValue={String(Math.abs(item.amount))}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="w-20 text-right text-sm rounded-md px-1.5 py-1"
          style={{ background: "var(--color-elevated)", color: "var(--color-text)", border: "1px solid var(--color-hairline)" }}
        />
      ) : (
        <button
          onClick={() => {
            setVal(String(Math.abs(item.amount)));
            setEditing(true);
          }}
          className="font-figure text-sm shrink-0"
          style={{ color: item.kind === "income" ? "var(--color-positive)" : "var(--color-text)" }}
        >
          {fmt(item.amount)}
        </button>
      )}
      {onDelete && (
        <button onClick={onDelete} className="material-symbols-outlined" style={{ fontSize: 18, color: "var(--color-faint)" }}>
          close
        </button>
      )}
    </div>
  );
}

function AddItemForm({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, kind: PlanItemKind, amount: number) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [isIncome, setIsIncome] = useState(false);

  return (
    <Card className="p-3 space-y-3">
      <Input label="Name" placeholder="e.g. Car registration" value={name} onChange={(e) => setName(e.target.value)} />
      <Input label="Amount" placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <div className="flex gap-2 text-xs">
        <button
          onClick={() => setIsIncome(false)}
          className="px-3 py-1.5 rounded-full font-semibold"
          style={{
            background: !isIncome ? "var(--color-primary)" : "var(--color-elevated)",
            color: !isIncome ? "#fff" : "var(--color-muted)",
          }}
        >
          Payment
        </button>
        <button
          onClick={() => setIsIncome(true)}
          className="px-3 py-1.5 rounded-full font-semibold"
          style={{
            background: isIncome ? "var(--color-primary)" : "var(--color-elevated)",
            color: isIncome ? "#fff" : "var(--color-muted)",
          }}
        >
          Income
        </button>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          fullWidth
          onClick={() => {
            const mag = Math.abs(parseFloat(amount));
            if (!name.trim() || isNaN(mag) || mag === 0) return;
            onAdd(name.trim(), isIncome ? "income" : "bill", isIncome ? mag : -mag);
          }}
        >
          Add
        </Button>
      </div>
    </Card>
  );
}

function SummaryRow({
  label,
  value,
  accent,
  bold,
}: {
  label: string;
  value: string;
  accent?: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span style={{ color: "var(--color-muted)" }}>{label}</span>
      <span
        className="font-figure"
        style={{ color: accent ?? "var(--color-text)", fontWeight: bold ? 700 : 500 }}
      >
        {value}
      </span>
    </div>
  );
}
