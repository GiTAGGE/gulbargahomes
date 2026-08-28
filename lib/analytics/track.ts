import { GA4_MEASUREMENT_ID, isAnalyticsEnabled } from "./config";
import type { ContactSource, PropertyAnalyticsContext } from "./types";

type Gtag = (...args: unknown[]) => void;

declare global {
  interface Window {
    gtag?: Gtag;
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

export function pageview(url: string): void {
  if (!isAnalyticsEnabled() || typeof window === "undefined" || !window.gtag) return;

  window.gtag("config", GA4_MEASUREMENT_ID, {
    page_path: url,
  });
}

export function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!isAnalyticsEnabled() || typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, eventParams(params));
}

function clarityTag(key: string, value: string): void {
  if (!isAnalyticsEnabled() || typeof window === "undefined" || !window.clarity) return;
  window.clarity("set", key, value);
}

export function trackPhoneClick(
  source: ContactSource,
  context: PropertyAnalyticsContext = {},
): void {
  const params = { contact_source: source, ...context };
  trackEvent("phone_click", params);
  trackEvent("generate_lead", { method: "phone", ...params });
  clarityTag("contact", "phone");
}

export function trackWhatsAppClick(
  source: ContactSource,
  context: PropertyAnalyticsContext = {},
): void {
  const params = { contact_source: source, ...context };
  trackEvent("whatsapp_click", params);
  trackEvent("generate_lead", { method: "whatsapp", ...params });
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
