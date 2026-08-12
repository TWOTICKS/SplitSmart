"use client";

import { useEffect } from "react";
import { startSyncListeners } from "@/lib/offline/sync";

export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // ponytail: PWA installability degrades gracefully — the app still
        // works online without the service worker, just without precache.
      });
    }
    return startSyncListeners();
  }, []);

  return null;
}
