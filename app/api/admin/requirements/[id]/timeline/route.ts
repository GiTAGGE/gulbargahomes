import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { expectedVersion } from "@/lib/crm/input";
import { getRequirement } from "@/lib/crm/requirements";
import { TIMELINE_PERMISSION, extendRequirementTimeline } from "@/lib/crm/timeline";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  const auth = await authorize(request, TIMELINE_PERMISSION.extend);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const current = await getRequirement(auth.db, id);
    if (!current) return jsonError(404, "Requirement not found.");
    const body = await readJson(request);
    await extendRequirementTimeline(auth.db, auth.admin, current, body, {
      now: nowIso(),
      expectedVersion: expectedVersion(body.rowVersion),
    });
    const requirement = await getRequirement(auth.db, id);
    return NextResponse.json({ ok: true, requirement });
  } catch (error) {
    return errorResponse(error);
  }
}
