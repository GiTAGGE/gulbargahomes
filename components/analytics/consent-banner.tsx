"use client";

import Link from "next/link";

import { writeAnalyticsConsent } from "@/lib/analytics/consent";
import { pageview } from "@/lib/analytics/track";

import { useAnalyticsConsent } from "./use-analytics-consent";

export function ConsentBanner() {
  const consent = useAnalyticsConsent();
  if (consent !== null) return null;

  function choose(value: "granted" | "denied") {
    writeAnalyticsConsent(value);
    if (value === "granted") {
      const query = window.location.search;
      pageview(`${window.location.pathname}${query}`);
    }
  }

  return (
    <div
      role="region"
      aria-label="Analytics choice"
      className="fixed inset-x-3 bottom-20 z-50 mx-auto max-w-3xl rounded-2xl border border-brand-100 bg-white p-4 shadow-lift md:bottom-5"
    >
      <p className="text-sm leading-relaxed text-ink">
        GulbargaHomes can use Google Analytics on the live site to measure pages and actions such
        as call and WhatsApp clicks. Saved homes stay in this browser either way.
      </p>
      <p className="mt-2 text-sm text-ink-muted">
        <Link href="/privacy-policy#cookies-and-analytics" className="font-semibold text-brand-700 underline-offset-2 hover:underline">
          Privacy Policy
        </Link>
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn-primary" onClick={() => choose("granted")}>
          Allow analytics
        </button>
        <button type="button" className="btn-ghost" onClick={() => choose("denied")}>
          Decline
        </button>
      </div>
    </div>
  );
}
