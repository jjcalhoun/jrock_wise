"use client";

import { useEffect, useState } from "react";

/* Reactively track a media query. SSR-safe (returns false until mounted, so the
   server and first client render agree — no hydration mismatch). Layout that
   must be correct on first paint should prefer CSS breakpoints; use this for
   behavior that genuinely needs JS (e.g. list+detail vs sheet). */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** True on wide (desktop) screens — matches the Tailwind `lg` breakpoint. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");
