import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { createFollowup, listFollowups } from "@/lib/crm/activity";
import { nowIso } from "@/lib/db/sql";

export async function GET(request: Request) {
  const auth = await authorize(request, "crm.view");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType") ?? undefined;
  const entityId = url.searchParams.get("entityId") ?? undefined;
  const dueBefore = url.searchParams.get("dueBefore") ?? undefined;
  if (!dueBefore && !(entityType && entityId)) return jsonError(400, "Say which follow-ups to load.");
  try {
    return NextResponse.json({
      followups: await listFollowups(auth.db, { entityType, entityId, openDueBefore: dueBefore }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, "followup.manage");
  if ("response" in auth) return auth.response;
  try {
    const followup = await createFollowup(auth.db, auth.admin, await readJson(request), nowIso());
    return NextResponse.json({ ok: true, followup }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
