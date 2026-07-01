"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true);

/* "Install app" affordance — only rendered in a browser (not when already
   installed) and only once the browser has offered an install prompt. */
export function InstallButton() {
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    const sync = () => {
      const bip = (window as unknown as { __bip?: Event }).__bip;
      setCanInstall(!!bip && !isStandalone());
    };
    sync();
    window.addEventListener("bip-available", sync);
    return () => window.removeEventListener("bip-available", sync);
  }, []);

  if (!canInstall) return null;

  async function install() {
    const bip = (window as unknown as { __bip?: BeforeInstallPromptEvent }).__bip;
    if (!bip) return;
    await bip.prompt();
    await bip.userChoice;
    (window as unknown as { __bip?: Event }).__bip = undefined;
    setCanInstall(false);
  }

  return (
    <Button variant="secondary" fullWidth onClick={install}>
      <span className="material-symbols-outlined mr-2" style={{ fontSize: 18 }}>
        install_mobile
      </span>
      Install app
    </Button>
  );
}
