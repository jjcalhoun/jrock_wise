"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const variantStyles: Record<Variant, React.CSSProperties> = {
  primary: { background: "var(--color-primary)", color: "#fff" },
  secondary: { background: "var(--color-elevated)", color: "var(--color-text)", border: "1px solid var(--color-hairline)" },
  ghost: { background: "transparent", color: "var(--color-muted)" },
  danger: { background: "var(--color-danger)", color: "#fff" },
};

const sizeClasses: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs rounded-[9999px]",
  md: "px-4 py-2.5 text-sm rounded-[9999px]",
  lg: "px-6 py-3.5 text-base rounded-[9999px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", fullWidth, className, style, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center font-semibold transition-opacity disabled:opacity-50 active:opacity-70 ${sizeClasses[size]} ${fullWidth ? "w-full" : ""} ${className ?? ""}`}
        style={{ ...variantStyles[variant], ...style }}
        {...props}
      >
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
