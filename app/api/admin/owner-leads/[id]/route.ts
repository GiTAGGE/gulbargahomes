import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { expectedVersion } from "@/lib/crm/input";
import { getOwnerLead, updateOwnerLead } from "@/lib/crm/owner-leads";
import { redactContactPhone } from "@/lib/crm/redact";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await authorize(request, "crm.view");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const lead = await getOwnerLead(auth.db, id);
    if (!lead) return jsonError(404, "Owner lead not found.");
    return NextResponse.json({ lead: redactContactPhone(lead, can(auth.admin.role, "contact.view_phone")) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(request, "crm.edit");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const current = await getOwnerLead(auth.db, id);
    if (!current) return jsonError(404, "Owner lead not found.");
    const body = await readJson(request);
    const lead = await updateOwnerLead(auth.db, auth.admin, current, body, {
      now: nowIso(),
      expectedVersion: expectedVersion(body.rowVersion),
    });
    return NextResponse.json({ ok: true, lead });
  } catch (error) {
    return errorResponse(error);
  }
}
