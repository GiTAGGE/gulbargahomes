import { HttpError } from "../admin/errors";
import { DatabaseUnavailableError, requireDatabase } from "../db/database";
import { hashClientIp, trustedClientIp } from "./client-ip";
import { ATTRIBUTION_COOKIE } from "./cookie";
import { submitLandJvEnquiry, submitOwnerEnquiry, submitRequirementEnquiry, type EnquiryKind } from "./submit";
import { verifyTurnstile } from "./turnstile";

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  const found = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!found) return null;
  try {
    return decodeURIComponent(found.slice(name.length + 1));
  } catch {
    return null;
  }
}

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status });
}

export async function postEnquiry(request: Request, kind: EnquiryKind): Promise<Response> {
  try {
    const body = await request.json().catch(() => null);
    const token = body && typeof body === "object" && "turnstileToken" in body && typeof body.turnstileToken === "string" ? body.turnstileToken : "";
    const ip = trustedClientIp(request.headers);
    if (!ip) throw new HttpError(400, "The enquiry could not be submitted.");
    const human = await verifyTurnstile(token, process.env.TURNSTILE_SECRET_KEY ?? "", ip);
    if (!human) throw new HttpError(403, "The enquiry check failed. Please try again.");
    const db = await requireDatabase();
    const headerKey = request.headers.get("idempotency-key") ?? "";
    const bodyKey = body && typeof body === "object" && "idempotencyKey" in body && typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
    const key = headerKey || bodyKey;
    const options = {
      now: new Date().toISOString(),
      ipHash: await hashClientIp(ip),
      idempotencyKey: key,
      humanVerified: true,
      attributionCookie: cookieValue(request.headers.get("cookie"), ATTRIBUTION_COOKIE),
      attributionSecret: process.env.ENQUIRY_ATTRIBUTION_SECRET ?? "",
    };
    const result =
      kind === "requirement"
        ? await submitRequirementEnquiry(db, body, options)
        : kind === "owner"
          ? await submitOwnerEnquiry(db, body, options)
          : await submitLandJvEnquiry(db, body, options);
    return Response.json(result);
  } catch (error) {
    if (error instanceof HttpError) return jsonError(error.status, error.message);
    if (error instanceof DatabaseUnavailableError) return jsonError(503, error.message);
    console.error("website enquiry failed");
    return jsonError(500, "Something went wrong. Nothing was saved.");
  }
}
