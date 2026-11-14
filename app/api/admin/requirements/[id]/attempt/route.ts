import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { getRequirement } from "@/lib/crm/requirements";
import { TIMELINE_PERMISSION, recordContactAttempt } from "@/lib/crm/timeline";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const auth = await authorize(request, TIMELINE_PERMISSION.attempt);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const current = await getRequirement(auth.db, id);
    if (!current) return jsonError(404, "Requirement not found.");
    const activity = await recordContactAttempt(auth.db, auth.admin, current, await readJson(request), nowIso());
    return NextResponse.json({ ok: true, activity }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
