"use client";

import { useEffect } from "react";

function canRegisterServiceWorker() {
  if (typeof window === "undefined") return false;
  return "serviceWorker" in navigator;
}

export function PwaRegistrar({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled || !canRegisterServiceWorker()) return;

    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("Falha ao registrar service worker:", error);
    });
  }, [enabled]);

  return null;
}
