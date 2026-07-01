"use client";

import { useEffect } from "react";

/* Registers the service worker (enables install + auto-update on next launch)
   and captures the browser's install prompt globally so the Install button can
   offer it later, wherever the user happens to be. Renders nothing. */
export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      (window as unknown as { __bip?: Event }).__bip = e;
      window.dispatchEvent(new Event("bip-available"));
    };
    const onInstalled = () => {
      (window as unknown as { __bip?: Event }).__bip = undefined;
      window.dispatchEvent(new Event("bip-available"));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
