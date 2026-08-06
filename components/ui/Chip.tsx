"use client";

import { ButtonHTMLAttributes } from "react";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  color?: string; // override active background
  /** de-emphasised but still selectable — e.g. an option already claimed
   *  elsewhere, which stays offered rather than being hidden */
  dim?: boolean;
}

export function Chip({ active, color, dim, className, style, children, ...props }: ChipProps) {
  return (
    <button
      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-[9999px] text-xs font-semibold transition-colors ${className ?? ""}`}
      style={{
        background: active ? (color ?? "var(--color-primary)") : "var(--color-chip-bg)",
        color: active ? "#fff" : "var(--color-muted)",
        opacity: dim && !active ? 0.55 : 1,
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}
