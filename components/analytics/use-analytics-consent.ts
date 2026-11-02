"use client";

import { useEffect, useState } from "react";

import {
  ANALYTICS_CONSENT_EVENT,
  readAnalyticsConsent,
  type AnalyticsConsent,
} from "@/lib/analytics/consent";

/** `undefined` until the browser value has been read. */
export function useAnalyticsConsent(): AnalyticsConsent | null | undefined {
  const [value, setValue] = useState<AnalyticsConsent | null | undefined>(undefined);

  useEffect(() => {
    const read = () => setValue(readAnalyticsConsent());
    read();
    window.addEventListener(ANALYTICS_CONSENT_EVENT, read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener(ANALYTICS_CONSENT_EVENT, read);
      window.removeEventListener("storage", read);
    };
  }, []);

  return value;
}
