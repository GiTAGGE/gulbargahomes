import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { expectedVersion } from "@/lib/crm/input";
import { redactContactPhone } from "@/lib/crm/redact";
import { getRequirement, updateRequirement } from "@/lib/crm/requirements";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await authorize(request, "crm.view");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const requirement = await getRequirement(auth.db, id);
    if (!requirement) return jsonError(404, "Requirement not found.");
    return NextResponse.json({
      requirement: redactContactPhone(requirement, can(auth.admin.role, "contact.view_phone")),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(request, "crm.edit");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const current = await getRequirement(auth.db, id);
    if (!current) return jsonError(404, "Requirement not found.");
    const body = await readJson(request);
    const requirement = await updateRequirement(auth.db, auth.admin, current, body, {
      now: nowIso(),
      expectedVersion: expectedVersion(body.rowVersion),
    });
    return NextResponse.json({ ok: true, requirement });
  } catch (error) {
    return errorResponse(error);
  }
}
