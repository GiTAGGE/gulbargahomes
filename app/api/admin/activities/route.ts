import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { listActivities, logActivity, parseActivityInput } from "@/lib/crm/activity";
import { nowIso } from "@/lib/db/sql";

export async function GET(request: Request) {
  const auth = await authorize(request, "crm.view");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType") ?? undefined;
  const entityId = url.searchParams.get("entityId") ?? undefined;
  const contactId = url.searchParams.get("contactId") ?? undefined;
  if (!contactId && !(entityType && entityId)) return jsonError(400, "Say whose timeline to load.");
  try {
    return NextResponse.json({ activities: await listActivities(auth.db, { entityType, entityId, contactId }) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, "activity.log");
  if ("response" in auth) return auth.response;
  try {
    const activity = await logActivity(auth.db, auth.admin, parseActivityInput(await readJson(request)), nowIso());
    return NextResponse.json({ ok: true, activity }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
