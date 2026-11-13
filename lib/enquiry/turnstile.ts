type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Cloudflare Turnstile siteverify. An empty secret fails closed. */
export async function verifyTurnstile(token: string, secret: string, remoteIp: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  if (!secret || !token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = (await response.json().catch(() => null)) as { success?: boolean } | null;
    return response.ok && payload?.success === true;
  } catch {
    return false;
  }
}
