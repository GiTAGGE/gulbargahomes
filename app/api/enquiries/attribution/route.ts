import { ATTRIBUTION_COOKIE, attributionCookieHeader, establishAttribution } from "@/lib/enquiry/cookie";

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq > 0 && trimmed.slice(0, eq) === name) return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return null;
}

/** Confirms or starts the signed first-touch cookie before a visitor submits an enquiry. */
export async function GET(request: Request) {
  const now = new Date().toISOString();
  const result = await establishAttribution(
    readCookie(request.headers.get("cookie"), ATTRIBUTION_COOKIE),
    process.env.ENQUIRY_ATTRIBUTION_SECRET ?? "",
    request.url,
    request.headers.get("referer"),
    now,
  );
  const headers = new Headers({ "content-type": "application/json", "cache-control": "no-store" });
  if (result.sealed) {
    headers.append("set-cookie", attributionCookieHeader(result.sealed, new URL(request.url).protocol === "https:"));
  }
  return new Response(JSON.stringify({ established: result.established }), { status: 200, headers });
}
