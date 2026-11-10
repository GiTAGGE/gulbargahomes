import "server-only";

import { NextResponse } from "next/server";

import { DatabaseUnavailableError, requireDatabase } from "../db/database";
import type { SqlDb } from "../db/sql";
import { HttpError } from "./errors";
import { getCurrentAdmin, type AdminIdentity } from "./identity";
import { can, type Permission } from "./permissions";

export { HttpError };

export function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/**
 * Authenticates, reloads the admin, checks the permission and, for mutations,
 * rejects cross-origin requests. Returns either the context or a response.
 */
export async function authorize(
  request: Request,
  permission?: Permission,
): Promise<{ admin: AdminIdentity; db: SqlDb } | { response: NextResponse }> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && !sameOrigin(request)) {
    return { response: jsonError(403, "Request blocked: it did not come from the admin.") };
  }

  const admin = await getCurrentAdmin();
  if (!admin) return { response: jsonError(401, "Sign in required.") };
  if (permission && !can(admin.role, permission)) {
    return { response: jsonError(403, "Your role does not allow this.") };
  }

  try {
    return { admin, db: await requireDatabase() };
  } catch (error) {
    return { response: errorResponse(error) };
  }
}

export function requirePermission(admin: AdminIdentity, permission: Permission) {
  if (!can(admin.role, permission)) throw new HttpError(403, "Your role does not allow this.");
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof HttpError) return jsonError(error.status, error.message);
  if (error instanceof DatabaseUnavailableError) return jsonError(503, error.message);
  console.error(error);
  return jsonError(500, "Something went wrong. Nothing was saved.");
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Send the details as JSON.");
  }
  return body as Record<string, unknown>;
}
