/**
 * Trusted client IP for public enquiries on Cloudflare Workers.
 *
 * The Worker receives `CF-Connecting-IP` from Cloudflare's edge, which sets it
 * to the connecting client and overwrites a value supplied by the browser.
 * That header is the only address used for rate limiting.
 *
 * `X-Forwarded-For`, `X-Real-IP`, and any other forwarded header are ignored.
 * A missing, empty, or malformed `CF-Connecting-IP` is refused. Those requests
 * are not collected into one shared "unknown" bucket, so they cannot exhaust
 * or bypass the limit by omitting or changing an untrusted header.
 *
 * Local `next dev` does not add this header. The public route rejects those
 * requests until a proxy sets `CF-Connecting-IP`. Tests call the CRM submit
 * functions with an explicit hash and do not need the header.
 */

const IPV4 = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isIpv4(value: string): boolean {
  if (!IPV4.test(value)) return false;
  return value.split(".").every((part) => part === String(Number(part)));
}

function isIpv6(value: string): boolean {
  if (!value || value.length > 45 || !/^[0-9a-f:]+$/i.test(value) || value.includes(":::")) return false;
  const pieces = value.split("::");
  if (pieces.length > 2) return false;
  const groups = pieces.flatMap((piece) => (piece ? piece.split(":") : []));
  if (groups.length === 0) return false;
  if (pieces.length === 1 && groups.length !== 8) return false;
  if (pieces.length === 2 && groups.length > 7) return false;
  return groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group));
}

export function isClientIp(value: string): boolean {
  return isIpv4(value) || isIpv6(value);
}

/** The visitor address Cloudflare reports, or null when it cannot be trusted. */
export function trustedClientIp(headers: Headers): string | null {
  const value = headers.get("cf-connecting-ip");
  if (!value || value !== value.trim() || value.includes(",")) return null;
  return isClientIp(value) ? value : null;
}

export async function hashClientIp(ip: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`gulbargahomes-enquiry:${ip}`));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
