import { HTMLAttributes } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
}

export function Card({ elevated, className, style, children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-[16px] border ${className ?? ""}`}
      style={{
        background: elevated ? "var(--color-elevated)" : "var(--color-surface)",
        borderColor: "var(--color-hairline)",
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}
