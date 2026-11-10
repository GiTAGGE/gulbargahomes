/** PBKDF2-SHA256. 100,000 iterations is the maximum Cloudflare Workers allows. */
export const PASSWORD_ITERATIONS = 100_000;
export const MIN_PASSWORD_LENGTH = 10;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derive(password: string, saltHex: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)?.map((pair) => Number.parseInt(pair, 16)) ?? []);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(password: string) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = toHex(salt);
  return {
    hash: await derive(password, saltHex, PASSWORD_ITERATIONS),
    salt: saltHex,
    iterations: PASSWORD_ITERATIONS,
  };
}

export async function verifyPassword(
  password: string,
  stored: { hash: string; salt: string; iterations: number },
): Promise<boolean> {
  const candidate = await derive(password, stored.salt, stored.iterations);
  if (candidate.length !== stored.hash.length) return false;
  let diff = 0;
  for (let index = 0; index < candidate.length; index += 1) {
    diff |= candidate.charCodeAt(index) ^ stored.hash.charCodeAt(index);
  }
  return diff === 0;
}

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) return "Use 200 characters or fewer.";
  return null;
}
