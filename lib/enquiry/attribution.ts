import { text } from "../crm/input";

/** Where the visitor was discovered. This is not the CRM conversion channel. */
export const ACQUISITION_SOURCES = [
  "Google Organic",
  "Google Ads",
  "Facebook Organic",
  "Facebook Ads",
  "Instagram Organic",
  "Instagram Ads",
  "ChatGPT",
  "Other AI",
  "Direct",
  "Referral",
  "Unknown",
] as const;
export type AcquisitionSource = (typeof ACQUISITION_SOURCES)[number];

export type TouchEvidence = {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmCampaignId?: string;
  utmTerm?: string;
  utmContent?: string;
  landingPage?: string;
  referrer?: string;
  seenAt?: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  fbp?: string;
  fbc?: string;
};

export type ClassifiedTouch = {
  source: AcquisitionSource;
  medium: string;
  campaign: string;
  campaignId: string;
  term: string;
  content: string;
  landingPage: string;
  referrer: string;
  referrerDomain: string;
  seenAt: string;
  gclid: string;
  gbraid: string;
  wbraid: string;
  fbclid: string;
  fbp: string;
  fbc: string;
};

const PAID_MEDIUM = /^(cpc|ppc|paid|paidsocial|paid_social|ads|ad)$/i;
const CHATGPT_HOSTS = new Set(["chatgpt.com", "chat.openai.com"]);
const OTHER_AI_HOSTS = new Set([
  "perplexity.ai",
  "claude.ai",
  "copilot.microsoft.com",
  "phind.com",
  "you.com",
  "meta.ai",
  "gemini.google.com",
  "bard.google.com",
]);

function clip(value: unknown, max: number): string {
  return text(value, max).replace(/[\u0000-\u001F]/g, "");
}

function token(value: unknown, max: number): string {
  const raw = clip(value, max);
  return new RegExp(`^[A-Za-z0-9._~-]{1,${max}}$`).test(raw) ? raw : "";
}

function pageUrl(value: unknown): string {
  const raw = clip(value, 500);
  if (!raw) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.username = "";
    url.password = "";
    return url.toString().slice(0, 500);
  } catch {
    return "";
  }
}

export function referrerDomain(value: string): string {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function hostMatches(host: string, domains: Set<string>): boolean {
  return [...domains].some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function isGoogleHost(host: string): boolean {
  if (!host || hostMatches(host, new Set(["gemini.google.com", "bard.google.com"]))) return false;
  return host === "google.com" || host.endsWith(".google.com") || /^(google|[a-z]{2,3}\.google)\.[a-z.]+$/.test(host);
}

function isFacebookHost(host: string): boolean {
  return host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com" || host.endsWith(".fb.com");
}

function isInstagramHost(host: string): boolean {
  return host === "instagram.com" || host.endsWith(".instagram.com");
}

function sourceFromUtm(source: string, medium: string): AcquisitionSource | null {
  const name = source.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!name) return null;
  const paid = PAID_MEDIUM.test(medium);
  if (["google", "googleads", "adwords"].includes(name)) return paid ? "Google Ads" : "Google Organic";
  if (["facebook", "fb", "meta"].includes(name)) return paid ? "Facebook Ads" : "Facebook Organic";
  if (["instagram", "ig"].includes(name)) return paid ? "Instagram Ads" : "Instagram Organic";
  if (["chatgpt", "openai"].includes(name)) return "ChatGPT";
  if (["perplexity", "claude", "copilot", "gemini", "bard"].includes(name)) return "Other AI";
  return "Referral";
}

function sourceFromReferrer(host: string): AcquisitionSource | null {
  if (!host) return null;
  if (hostMatches(host, CHATGPT_HOSTS)) return "ChatGPT";
  if (hostMatches(host, OTHER_AI_HOSTS)) return "Other AI";
  if (isGoogleHost(host)) return "Google Organic";
  if (isInstagramHost(host)) return "Instagram Organic";
  if (isFacebookHost(host)) return "Facebook Organic";
  return "Referral";
}

function seenAt(value: unknown, now: string): string {
  if (typeof value !== "string") return now;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return now;
  const time = date.getTime();
  const current = new Date(now).getTime();
  if (time > current + 5 * 60_000) return now;
  if (current - time > 90 * 86_400_000) return now;
  return date.toISOString();
}

/** Classify one visit from evidence. A bare source label is ignored. */
export function classifyTouch(evidence: TouchEvidence | null | undefined, now: string): ClassifiedTouch {
  const utmSource = clip(evidence?.utmSource, 120);
  const utmMedium = clip(evidence?.utmMedium, 120);
  const referrer = pageUrl(evidence?.referrer);
  const domain = referrerDomain(referrer);
  const gclid = token(evidence?.gclid, 200);
  const gbraid = token(evidence?.gbraid, 200);
  const wbraid = token(evidence?.wbraid, 200);
  const fbclid = token(evidence?.fbclid, 200);
  const fromUtm = sourceFromUtm(utmSource, utmMedium);
  let source: AcquisitionSource = "Unknown";
  if (fromUtm) source = fromUtm;
  else if (gclid || gbraid || wbraid) source = "Google Ads";
  else if (fbclid) source = isInstagramHost(domain) ? "Instagram Ads" : "Facebook Ads";
  else {
    const referred = sourceFromReferrer(domain);
    if (referred) source = referred;
    else if (pageUrl(evidence?.landingPage)) source = "Direct";
  }
  const medium = utmMedium || (source.endsWith("Ads") ? "cpc" : source.endsWith("Organic") || source === "ChatGPT" || source === "Other AI" ? "organic" : source === "Direct" ? "direct" : "");
  return {
    source,
    medium: medium.slice(0, 120),
    campaign: clip(evidence?.utmCampaign, 160),
    campaignId: token(evidence?.utmCampaignId, 64),
    term: clip(evidence?.utmTerm, 160),
    content: clip(evidence?.utmContent, 160),
    landingPage: pageUrl(evidence?.landingPage),
    referrer,
    referrerDomain: domain.slice(0, 120),
    seenAt: seenAt(evidence?.seenAt, now),
    gclid,
    gbraid,
    wbraid,
    fbclid,
    fbp: token(evidence?.fbp, 200),
    fbc: token(evidence?.fbc, 200),
  };
}

export function readTouch(value: unknown): TouchEvidence {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    utmSource: clip(data.utmSource, 120),
    utmMedium: clip(data.utmMedium, 120),
    utmCampaign: clip(data.utmCampaign, 160),
    utmCampaignId: clip(data.utmCampaignId, 64),
    utmTerm: clip(data.utmTerm, 160),
    utmContent: clip(data.utmContent, 160),
    landingPage: clip(data.landingPage, 500),
    referrer: clip(data.referrer, 500),
    seenAt: clip(data.seenAt, 40),
    gclid: clip(data.gclid, 200),
    gbraid: clip(data.gbraid, 200),
    wbraid: clip(data.wbraid, 200),
    fbclid: clip(data.fbclid, 200),
    fbp: clip(data.fbp, 200),
    fbc: clip(data.fbc, 200),
  };
}
