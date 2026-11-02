"use client";

import { setGoogleAnalyticsDisabled, writeAnalyticsConsent } from "@/lib/analytics/consent";
import { GA4_MEASUREMENT_ID } from "@/lib/analytics/config";
import { pageview } from "@/lib/analytics/track";

import { useAnalyticsConsent } from "./use-analytics-consent";

export function AnalyticsChoice() {
  const consent = useAnalyticsConsent();
  const label =
    consent === undefined
      ? "Checking this browser…"
      : consent === "denied"
        ? "Analytics is off in this browser. It stays off on later visits until you turn it on here."
        : consent === "granted"
          ? "Analytics is on in this browser."
          : "Analytics is on in this browser. You can turn it off here. That choice is remembered.";

  function choose(value: "granted" | "denied") {
    writeAnalyticsConsent(value);
    setGoogleAnalyticsDisabled(GA4_MEASUREMENT_ID, value === "denied");
    if (value === "granted") {
      const query = window.location.search;
      pageview(`${window.location.pathname}${query}`);
    }
  }

  return (
    <div className="rounded-2xl border border-brand-100 bg-white p-4">
      <p className="text-sm font-semibold text-ink">Analytics on this browser</p>
      <p className="mt-1 text-sm text-ink-muted">{label}</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn-primary" onClick={() => choose("granted")}>
          Allow analytics
        </button>
        <button type="button" className="btn-ghost" onClick={() => choose("denied")}>
          Turn analytics off
        </button>
      </div>
    </div>
  );
}
