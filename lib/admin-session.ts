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
  return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET);
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

export async function createAdminSessionToken(): Promise<string | null> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return null;
  const expiresAt = Date.now() + SESSION_HOURS * 60 * 60 * 1000;
  const payload = String(expiresAt);
  const signature = await hmacHex(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifyAdminSessionToken(
  token: string | undefined,
): Promise<boolean> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!token || !secret) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expected = await hmacHex(secret, payload);
  return safeEqual(signature, expected);
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
