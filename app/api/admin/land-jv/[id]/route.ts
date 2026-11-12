import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { getLandJvEnquiry, updateLandJvVerification } from "@/lib/crm/land-jv";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(request, "crm.edit");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const current = await getLandJvEnquiry(auth.db, id);
    if (!current) return jsonError(404, "Land JV enquiry not found.");
    const body = await readJson(request);
    const enquiry = await updateLandJvVerification(
      auth.db,
      auth.admin,
      current,
      {
        verifiedVillage: body.verifiedVillage,
        additionalPhone: body.additionalPhone,
        rowVersion: Number.isInteger(body.rowVersion) ? Number(body.rowVersion) : undefined,
      },
      nowIso(),
    );
    return NextResponse.json({ ok: true, enquiry });
  } catch (error) {
    return errorResponse(error);
  }
}
