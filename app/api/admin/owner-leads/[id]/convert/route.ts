import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError, readJson, requirePermission } from "@/lib/admin/route";
import { convertOwnerLead, getOwnerLead } from "@/lib/crm/owner-leads";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

/** Creates an unverified, unpublished draft property for this owner. */
export async function POST(request: Request, context: Context) {
  const auth = await authorize(request, "crm.edit");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    requirePermission(auth.admin, "property.create");
    const lead = await getOwnerLead(auth.db, id);
    if (!lead) return jsonError(404, "Owner lead not found.");
    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
    const property = await convertOwnerLead(auth.db, auth.admin, lead, {
      now: nowIso(),
      title: typeof body.title === "string" ? body.title : undefined,
      listing: body.listing === "Rent" || body.listing === "Sale" ? body.listing : undefined,
    });
    return NextResponse.json({ ok: true, property }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
