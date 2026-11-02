import { readAnalyticsConsent } from "./consent";
import { GA4_MEASUREMENT_ID, isAnalyticsEnabled } from "./config";
import type { ContactSource, PropertyAnalyticsContext } from "./types";

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: Gtag;
    dataLayer?: unknown[];
    clarity?: (...args: unknown[]) => void;
  }
}

export function priceBand(price: number): string {
  if (price < 10_000) return "under-10k";
  if (price < 15_000) return "10k-15k";
  if (price < 20_000) return "15k-20k";
  if (price < 30_000) return "20k-30k";
  return "30k-plus";
}

function eventParams(
  params?: Record<string, string | number | boolean | null | undefined>,
): Record<string, string | number | boolean> {
  if (!params) return {};
  return Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined && entry[1] !== null,
    ),
  );
}

function analyticsAllowed(): boolean {
  return isAnalyticsEnabled() && readAnalyticsConsent() === "granted";
}

export function pageview(url: string): void {
  if (!analyticsAllowed()) return;
  const gtag = ensureGtag();
  if (!gtag) return;

  gtag("config", GA4_MEASUREMENT_ID, {
    page_path: url,
  });
}

function ensureGtag(): Gtag | null {
  if (typeof window === "undefined") return null;
  if (typeof window.gtag === "function") return window.gtag;

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer?.push(arguments);
  }
  window.gtag = gtag as Gtag;
  return window.gtag;
}

export function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean | null | undefined>,
  beacon = false,
): void {
  if (!analyticsAllowed()) return;
  const gtag = ensureGtag();
  if (!gtag) return;

  const payload = eventParams(params);
  // Beacon so the hit is sent before the browser opens the dialer or WhatsApp.
  if (beacon) payload.transport_type = "beacon";
  gtag("event", name, payload);
}

function clarityTag(key: string, value: string): void {
  if (!analyticsAllowed() || typeof window === "undefined" || !window.clarity) return;
  window.clarity("set", key, value);
}

export function trackPhoneClick(
  source: ContactSource,
  context: PropertyAnalyticsContext = {},
): void {
  const params = { contact_source: source, lead_type: "call", ...context };
  trackEvent("phone_click", params, true);
  trackEvent("generate_lead", { method: "phone", currency: "INR", ...params }, true);
  clarityTag("contact", "phone");
}

export function trackWhatsAppClick(
  source: ContactSource,
  context: PropertyAnalyticsContext = {},
): void {
  const params = { contact_source: source, lead_type: "whatsapp", ...context };
  trackEvent("whatsapp_click", params, true);
  trackEvent("generate_lead", { method: "whatsapp", currency: "INR", ...params }, true);
  clarityTag("contact", "whatsapp");
}

export function trackPropertyView(context: PropertyAnalyticsContext): void {
  trackEvent("view_item", {
    currency: "INR",
    page_type: "property_detail",
    ...context,
  });
  if (context.property_slug) {
    clarityTag("property", context.property_slug);
  }
}

export function trackAddToWishlist(context: PropertyAnalyticsContext): void {
  trackEvent("add_to_wishlist", {
    page_type: "property_detail",
    ...context,
  });
}

export function trackShare(context: PropertyAnalyticsContext): void {
  trackEvent("share", {
    method: "native_or_copy",
    page_type: "property_detail",
    ...context,
  });
}

export function trackSearch(searchTerm: string, source: string): void {
  trackEvent("search", {
    search_term: searchTerm,
    search_source: source,
  });
}
