"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { fmt0 } from "@/lib/format";
import { futureValue } from "@/lib/investments";
import { useUpdateSettings } from "@/hooks/useSupabaseData";
import type { Settings } from "@/lib/types";

interface Props {
  settings: Settings | null | undefined;
}

/* Investments tile — current balance, contributions, and a projection of the
   value at retirement. Inputs persist on the user's settings row. */
export function InvestmentCalculator({ settings }: Props) {
  const updateSettings = useUpdateSettings();

  const [balance, setBalance] = useState("0");
  const [ret, setRet] = useState("7");
  const [monthly, setMonthly] = useState("0");
  const [match, setMatch] = useState("0");
  const [currentAge, setCurrentAge] = useState("");
  const [retireAge, setRetireAge] = useState("");

  useEffect(() => {
    if (!settings) return;
    setBalance(String(settings.investments_balance ?? 0));
    setRet(String(settings.investments_return ?? 7));
    setMonthly(String(settings.invest_monthly ?? 0));
    setMatch(String(settings.invest_employer_match ?? 0));
    setCurrentAge(settings.invest_current_age != null ? String(settings.invest_current_age) : "");
    setRetireAge(settings.invest_retire_age != null ? String(settings.invest_retire_age) : "");
  }, [settings]);

  const cAge = parseInt(currentAge);
  const rAge = parseInt(retireAge);
  const years = !isNaN(cAge) && !isNaN(rAge) ? rAge - cAge : NaN;
  const canProject = !isNaN(years) && years > 0;

  const projected = canProject
    ? futureValue({
        balance: parseFloat(balance) || 0,
        monthly: (parseFloat(monthly) || 0) + (parseFloat(match) || 0),
        annualReturnPct: parseFloat(ret) || 0,
        years,
      })
    : 0;

  const num = (v: string) => parseFloat(v) || 0;
  const intOrNull = (v: string) => (v === "" ? null : parseInt(v) || null);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>Investments</h2>
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Current balance"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            onBlur={() => updateSettings.mutate({ investments_balance: num(balance) })}
          />
          <Input
            label="Annual return %"
            inputMode="decimal"
            value={ret}
            onChange={(e) => setRet(e.target.value)}
            onBlur={() => updateSettings.mutate({ investments_return: num(ret) })}
          />
          <Input
            label="Monthly contribution"
            inputMode="decimal"
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            onBlur={() => updateSettings.mutate({ invest_monthly: num(monthly) })}
          />
          <Input
            label="Employer match / mo"
            inputMode="decimal"
            value={match}
            onChange={(e) => setMatch(e.target.value)}
            onBlur={() => updateSettings.mutate({ invest_employer_match: num(match) })}
          />
          <Input
            label="Current age"
            inputMode="numeric"
            value={currentAge}
            onChange={(e) => setCurrentAge(e.target.value)}
            onBlur={() => updateSettings.mutate({ invest_current_age: intOrNull(currentAge) })}
          />
          <Input
            label="Retirement age"
            inputMode="numeric"
            value={retireAge}
            onChange={(e) => setRetireAge(e.target.value)}
            onBlur={() => updateSettings.mutate({ invest_retire_age: intOrNull(retireAge) })}
          />
        </div>

        <div
          className="rounded-[12px] p-4 text-center"
          style={{ background: "var(--color-elevated)" }}
        >
          {canProject ? (
            <>
              <p className="text-xs" style={{ color: "var(--color-muted)" }}>
                Projected value at age {rAge}
              </p>
              <p className="font-figure text-3xl font-bold mt-1" style={{ color: "#8B5CF6" }}>
                {fmt0(projected)}
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--color-faint)" }}>
                {years} yrs · {fmt0(num(monthly) + num(match))}/mo (incl. match) at {num(ret)}%
              </p>
            </>
          ) : (
            <p className="text-sm" style={{ color: "var(--color-faint)" }}>
              Enter your current and retirement age to project a value at retirement.
            </p>
          )}
        </div>
      </Card>
    </section>
  );
}
