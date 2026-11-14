import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, jsonError } from "@/lib/admin/route";
import { listRequirementMatches } from "@/lib/crm/matching";
import { getRequirement } from "@/lib/crm/requirements";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await authorize(request, "match.view");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const requirement = await getRequirement(auth.db, id);
    if (!requirement) return jsonError(404, "Requirement not found.");
    const matches = await listRequirementMatches(auth.db, id, {
      viewDiscreet: can(auth.admin.role, "property.view_discreet"),
    });
    return NextResponse.json({ matches });
  } catch (error) {
    return errorResponse(error);
  }
}
