interface ProgressBarProps {
  value: number;   // 0–100
  color?: string;
  overBudget?: boolean;
  className?: string;
}

export function ProgressBar({ value, color, overBudget, className }: ProgressBarProps) {
  const clampedValue = Math.min(100, Math.max(0, value));
  const barColor = overBudget ? "var(--color-danger)" : (color ?? "var(--color-primary)");

  return (
    <div
      className={`w-full h-1.5 rounded-full overflow-hidden ${className ?? ""}`}
      style={{ background: "var(--color-hairline)" }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${clampedValue}%`, background: barColor }}
      />
    </div>
  );
}
