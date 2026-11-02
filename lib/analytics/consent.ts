export const ANALYTICS_CONSENT_KEY = "gh-analytics-consent";

export const ANALYTICS_CONSENT_EVENT = "gh-analytics-consent";

export type AnalyticsConsent = "granted" | "denied";

export function readAnalyticsConsent(): AnalyticsConsent | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    if (value === "granted" || value === "denied") return value;
    return null;
  } catch {
    return null;
  }
}

export function writeAnalyticsConsent(value: AnalyticsConsent): void {
  localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
  window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
}
