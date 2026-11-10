import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError } from "@/lib/admin/route";
import { listAudit } from "@/lib/admin/audit";

export async function GET(request: Request) {
  const auth = await authorize(request, "audit.view");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  if (!entityType || !entityId) return jsonError(400, "Say whose history to load.");
  try {
    return NextResponse.json({ entries: await listAudit(auth.db, { entityType, entityId, limit: 200 }) });
  } catch (error) {
    return errorResponse(error);
  }
}
