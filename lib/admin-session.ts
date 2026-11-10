export const ADMIN_COOKIE = "gh_admin";
const SESSION_HOURS = 12;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return bytesToHex(new Uint8Array(signature));
}

function safeEqual(a: string, b: string): boolean {
  const left = hexToBytes(a);
  const right = hexToBytes(b);
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

export function adminSecretsConfigured(): boolean {
  return Boolean(process.env.ADMIN_SESSION_SECRET);
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;

  const [given, actual] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(password)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  const left = new Uint8Array(given);
  const right = new Uint8Array(actual);
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

/** Session subject for the shared ADMIN_PASSWORD login. */
export const LEGACY_ADMIN_SUBJECT = "legacy";

export type AdminSession = { subject: string; expiresAt: number };

export function legacyLoginEnabled(): boolean {
  return (
    Boolean(process.env.ADMIN_PASSWORD) &&
    (process.env.ADMIN_LEGACY_LOGIN ?? "").toLowerCase() !== "disabled"
  );
}

export async function createAdminSessionToken(
  subject: string = LEGACY_ADMIN_SUBJECT,
): Promise<string | null> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || !/^[A-Za-z0-9_-]+$/.test(subject)) return null;
  const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = `v2.${expiresAt}.${subject}`;
  const signature = await hmacHex(secret, payload);
  return `${payload}.${signature}`;
}

/**
 * Reads `v2.<expires>.<subject>.<sig>` tokens, and the earlier `<expires>.<sig>`
 * shape, which maps to the shared-password admin until it expires.
 */
export async function readAdminSessionToken(
  token: string | undefined,
): Promise<AdminSession | null> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!token || !secret) return null;

  const parts = token.split(".");
  let payload: string;
  let signature: string;
  let expiresRaw: string;
  let subject: string;

  if (parts.length === 4 && parts[0] === "v2") {
    [, expiresRaw, subject, signature] = parts;
    payload = `v2.${expiresRaw}.${subject}`;
  } else if (parts.length === 2) {
    [expiresRaw, signature] = parts;
    payload = expiresRaw;
    subject = LEGACY_ADMIN_SUBJECT;
  } else {
    return null;
  }

  const expiresAt = Number(expiresRaw);
  if (!subject || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  const expected = await hmacHex(secret, payload);
  if (!safeEqual(signature, expected)) return null;
  if (subject === LEGACY_ADMIN_SUBJECT && !legacyLoginEnabled()) return null;
  return { subject, expiresAt };
}

export async function verifyAdminSessionToken(
  token: string | undefined,
): Promise<boolean> {
  return (await readAdminSessionToken(token)) !== null;
}

export function adminSessionCookie(token: string) {
  return {
    name: ADMIN_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  };
}

export function clearAdminSessionCookie() {
  return {
    name: ADMIN_COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}
