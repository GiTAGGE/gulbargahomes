import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { expectedVersion } from "@/lib/crm/input";
import { REQUIREMENT_REVIEW_DECISIONS, type RequirementReviewDecision } from "@/lib/crm/review";
import { getRequirement, setRequirementQuality } from "@/lib/crm/requirements";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

/** Marks a buyer or tenant requirement genuine, unqualified, or pending again. Does not change its status. */
export async function POST(request: Request, context: Context) {
  const auth = await authorize(request, "crm.edit");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const current = await getRequirement(auth.db, id);
    if (!current) return jsonError(404, "Requirement not found.");
    const body = await readJson(request);
    const decision = (REQUIREMENT_REVIEW_DECISIONS as readonly string[]).includes(String(body.decision))
      ? (body.decision as RequirementReviewDecision)
      : null;
    if (!decision) return jsonError(400, "Choose whether this requirement is genuine.");
    const requirement = await setRequirementQuality(auth.db, auth.admin, current, decision, body.note, {
      now: nowIso(),
      expectedVersion: expectedVersion(body.rowVersion),
    });
    return NextResponse.json({ ok: true, requirement });
  } catch (error) {
    return errorResponse(error);
  }
}
