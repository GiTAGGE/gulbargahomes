"use client";

import { useEffect } from "react";

import { GA4_MEASUREMENT_ID, isAnalyticsEnabled } from "@/lib/analytics/config";

import { useAnalyticsConsent } from "./use-analytics-consent";

export function GoogleAnalytics() {
  const consent = useAnalyticsConsent();

  useEffect(() => {
    if (consent !== "granted") return;
    if (!isAnalyticsEnabled() || !GA4_MEASUREMENT_ID) return;
    if (document.getElementById("google-analytics-src")) return;

    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag !== "function") {
      window.gtag = function gtag() {
        window.dataLayer?.push(arguments);
      };
    }
    window.gtag("js", new Date());
    window.gtag("config", GA4_MEASUREMENT_ID, { send_page_view: false });

    const script = document.createElement("script");
    script.id = "google-analytics-src";
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_MEASUREMENT_ID)}`;
    document.head.appendChild(script);
  }, [consent]);

  return null;
}
