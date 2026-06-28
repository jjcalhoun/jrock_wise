"use client";

import { ButtonHTMLAttributes } from "react";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  color?: string; // override active background
}

export function Chip({ active, color, className, style, children, ...props }: ChipProps) {
  return (
    <button
      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-[9999px] text-xs font-semibold transition-colors ${className ?? ""}`}
      style={{
        background: active ? (color ?? "var(--color-primary)") : "var(--color-chip-bg)",
        color: active ? "#fff" : "var(--color-muted)",
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}
