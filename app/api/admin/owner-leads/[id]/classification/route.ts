import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { expectedVersion } from "@/lib/crm/input";
import { getOwnerLead, setOwnerLeadRoleReview } from "@/lib/crm/owner-leads";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

/** Marks an owner lead as not an owner, or restores that classification. Does not change lead status. */
export async function POST(request: Request, context: Context) {
  const auth = await authorize(request, "crm.edit");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const current = await getOwnerLead(auth.db, id);
    if (!current) return jsonError(404, "Owner lead not found.");
    const body = await readJson(request);
    const decision = body.decision === "misclassified" || body.decision === "owner" ? body.decision : null;
    if (!decision) return jsonError(400, "Choose whether this person is an owner.");
    const lead = await setOwnerLeadRoleReview(auth.db, auth.admin, current, decision, body.note, {
      now: nowIso(),
      expectedVersion: expectedVersion(body.rowVersion),
    });
    return NextResponse.json({ ok: true, lead });
  } catch (error) {
    return errorResponse(error);
  }
}
