import { constantTimeEqual, hmacSha256Hex } from "../meta/crypto";
import { readTouch, type TouchEvidence } from "./attribution";
import { rememberVisit, type AttributionMemory } from "./capture";

export const ATTRIBUTION_COOKIE = "gh_attr";
export const ATTRIBUTION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

type SealedPayload = {
  v: 1;
  exp: number;
  first: TouchEvidence;
  last: TouchEvidence;
};

function encode(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    return atob(padded);
  } catch {
    return null;
  }
}

function memoryOf(payload: SealedPayload): AttributionMemory {
  return { first: readTouch(payload.first), last: readTouch(payload.last) };
}

/** Signs the first and last visit. The value is safe to store in an HttpOnly cookie. */
export async function sealAttribution(memory: AttributionMemory, secret: string, now: string): Promise<string | null> {
  if (!secret) return null;
  const payload: SealedPayload = {
    v: 1,
    exp: new Date(now).getTime() + ATTRIBUTION_MAX_AGE_SECONDS * 1000,
    first: readTouch(memory.first),
    last: readTouch(memory.last),
  };
  const body = encode(JSON.stringify(payload));
  const signature = await hmacSha256Hex(secret, body);
  return `v1.${body}.${signature}`;
}

/** Returns the visits only when the signature, version, and expiry all check out. */
export async function openAttribution(value: string | null | undefined, secret: string, now: string): Promise<AttributionMemory | null> {
  if (!secret || !value) return null;
  const [version, body, signature, extra] = value.split(".");
  if (version !== "v1" || !body || !signature || extra !== undefined) return null;
  const expected = await hmacSha256Hex(secret, body);
  if (!constantTimeEqual(expected, signature)) return null;
  const json = decode(body);
  if (!json) return null;
  let payload: SealedPayload;
  try {
    payload = JSON.parse(json) as SealedPayload;
  } catch {
    return null;
  }
  const nowMs = new Date(now).getTime();
  if (payload?.v !== 1 || typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return null;
  if (payload.exp <= nowMs) return null;
  if (payload.exp > nowMs + ATTRIBUTION_MAX_AGE_SECONDS * 1000 + 5 * 60_000) return null;
  if (!payload.first || !payload.last || typeof payload.first !== "object" || typeof payload.last !== "object") return null;
  return memoryOf(payload);
}

/**
 * Cookie first-touch wins. A submitted visit may replace only the last touch.
 * A direct or unknown visit does not replace a known first touch.
 */
export function mergeSignedAttribution(signed: AttributionMemory, submitted: TouchEvidence, now: string): AttributionMemory {
  return rememberVisit(signed, submitted, now);
}

/** Evidence on a page URL. A source name that is not backed by a parameter or referrer is ignored. */
export function touchFromUrl(url: URL, referrer: string | null): TouchEvidence {
  return readTouch({
    utmSource: url.searchParams.get("utm_source") ?? "",
    utmMedium: url.searchParams.get("utm_medium") ?? "",
    utmCampaign: url.searchParams.get("utm_campaign") ?? "",
    utmCampaignId: url.searchParams.get("utm_id") || url.searchParams.get("utm_campaign_id") || "",
    utmTerm: url.searchParams.get("utm_term") ?? "",
    utmContent: url.searchParams.get("utm_content") ?? "",
    gclid: url.searchParams.get("gclid") ?? "",
    gbraid: url.searchParams.get("gbraid") ?? "",
    wbraid: url.searchParams.get("wbraid") ?? "",
    fbclid: url.searchParams.get("fbclid") ?? "",
    landingPage: `${url.pathname}${url.search}`.slice(0, 500),
    referrer: referrer ?? "",
  });
}

export async function nextAttributionCookie(current: string | null, url: URL, referrer: string | null, secret: string, now: string): Promise<string | null> {
  const existing = await openAttribution(current, secret, now);
  const memory = rememberVisit(existing, touchFromUrl(url, referrer), now);
  return sealAttribution(memory, secret, now);
}

export function attributionCookieHeader(value: string, secure: boolean): string {
  const parts = [
    `${ATTRIBUTION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${ATTRIBUTION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
