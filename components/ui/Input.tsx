import { InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, style, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label className="text-xs font-medium" style={{ color: "var(--color-muted)" }}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full px-4 py-3 rounded-xl text-sm outline-none border focus:border-[color:var(--color-primary)] transition-colors ${className ?? ""}`}
          style={{
            background: "var(--color-elevated)",
            color: "var(--color-text)",
            borderColor: error ? "var(--color-danger)" : "var(--color-hairline)",
            ...style,
          }}
          {...props}
        />
        {error && (
          <p className="text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>
        )}
      </div>
    );
  },
);
Input.displayName = "Input";
