"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, createContext, useContext, useEffect } from "react";
import type { ThemeMode } from "@/lib/types";

/* ---- TanStack Query ---- */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Keep data cached across tab switches so navigation is instant.
        // Mutations (add/edit/import/review) invalidate the relevant queries,
        // so the cache stays correct without time-based refetching.
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
let browserQueryClient: QueryClient | undefined;
function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

/* ---- Theme ---- */
interface ThemeContextValue {
  themeMode: ThemeMode;
  resolvedTheme: "dark" | "light";
  setThemeMode: (m: ThemeMode) => void;
}
const ThemeContext = createContext<ThemeContextValue>({
  themeMode: "system",
  resolvedTheme: "dark",
  setThemeMode: () => {},
});
export const useTheme = () => useContext(ThemeContext);

export function Providers({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const [prefersDark, setPrefersDark] = useState(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setPrefersDark(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const resolvedTheme: "dark" | "light" =
    themeMode === "system" ? (prefersDark ? "dark" : "light") : themeMode;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", resolvedTheme === "light");
  }, [resolvedTheme]);

  return (
    <ThemeContext.Provider value={{ themeMode, resolvedTheme, setThemeMode }}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeContext.Provider>
  );
}
