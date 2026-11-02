"use client";

import { writeAnalyticsConsent } from "@/lib/analytics/consent";
import { pageview } from "@/lib/analytics/track";

import { useAnalyticsConsent } from "./use-analytics-consent";

export function AnalyticsChoice() {
  const consent = useAnalyticsConsent();
  const label =
    consent === undefined
      ? "Checking this browser…"
      : consent === "granted"
        ? "Analytics is allowed in this browser."
        : consent === "denied"
          ? "Analytics is declined in this browser."
          : "You have not chosen yet. The Google tag stays off until you allow it.";

  function choose(value: "granted" | "denied") {
    writeAnalyticsConsent(value);
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
          Decline analytics
        </button>
      </div>
    </div>
  );
}
