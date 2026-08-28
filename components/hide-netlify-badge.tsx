"use client";

import { useEffect } from "react";

const HUD_KEYS = ["nl-hud:public:v1", "nl-hud:owner-private:v1"];

export function HideNetlifyBadge() {
  useEffect(() => {
    try {
      for (const key of HUD_KEYS) {
        localStorage.setItem(key, "hidden");
      }
    } catch {
      // Ignore private-mode storage errors.
    }

    const strip = () => {
      document.getElementById("nl-badge-frame")?.remove();
      document.getElementById("nl-hud-frame")?.remove();
    };

    strip();
    const observer = new MutationObserver(strip);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
