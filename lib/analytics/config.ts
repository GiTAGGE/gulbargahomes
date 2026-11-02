const GA4_ID_PATTERN = /^G-[A-Z0-9]+$/;

/** Public GA4 measurement ID from the GulbargaHomes Google tag. */
const DEFAULT_GA4_MEASUREMENT_ID = "G-47GFXYGBTL";

function measurementId(): string {
  const configured = process.env.NEXT_PUBLIC_GA4_ID?.trim().toUpperCase();
  if (configured && GA4_ID_PATTERN.test(configured)) return configured;
  return DEFAULT_GA4_MEASUREMENT_ID;
}

export const GA4_MEASUREMENT_ID = measurementId();

export const CLARITY_PROJECT_ID = process.env.NEXT_PUBLIC_CLARITY_ID ?? "";

export function isAnalyticsEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DISABLE_ANALYTICS === "true") return false;
  if (process.env.NODE_ENV !== "production") return false;
  return Boolean(GA4_MEASUREMENT_ID || CLARITY_PROJECT_ID);
}
