"use client";

import { useEffect } from "react";

interface SheetProps {
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function Sheet({ title, onClose, children }: SheetProps) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end lg:justify-center lg:items-center lg:p-6">
      {/* Scrim */}
      <div className="absolute inset-0 scrim" onClick={onClose} />

      {/* Panel — bottom sheet on mobile, centered dialog on desktop */}
      <div
        className="relative z-10 w-full max-w-[430px] mx-auto rounded-t-[24px] overflow-hidden lg:rounded-[24px] lg:max-w-lg lg:border"
        style={{ background: "var(--color-elevated)", borderColor: "var(--color-hairline)" }}
      >
        {/* Drag handle (mobile only) */}
        <div className="flex justify-center pt-3 pb-2 lg:hidden">
          <div className="w-10 h-1 rounded-full" style={{ background: "var(--color-hairline)" }} />
        </div>

        {title && (
          <div
            className="flex items-center justify-between px-5 pb-4 lg:pt-4 border-b"
            style={{ borderColor: "var(--color-hairline)" }}
          >
            <span className="font-semibold text-base" style={{ color: "var(--color-text)" }}>
              {title}
            </span>
            <button onClick={onClose} style={{ color: "var(--color-muted)" }}>
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
            </button>
          </div>
        )}

        <div className="overflow-y-auto max-h-[80vh] pb-safe">
          {children}
        </div>
      </div>
    </div>
  );
}
