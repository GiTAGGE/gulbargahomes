export const GA4_MEASUREMENT_ID = process.env.NEXT_PUBLIC_GA4_ID ?? "";

export const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_ID ?? "";

export function isAnalyticsEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DISABLE_ANALYTICS === "true") return false;
  if (process.env.NODE_ENV !== "production") return false;
  return Boolean(GA4_MEASUREMENT_ID || CLARITY_PROJECT_ID);
}
