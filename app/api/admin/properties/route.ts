import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, readJson } from "@/lib/admin/route";
import { nowIso } from "@/lib/db/sql";
import { availabilityFromInput, createDraftProperty } from "@/lib/inventory/repository";
import { parsePropertyDraft } from "@/lib/property-input";

/** Creates an unpublished draft. Publishing is a separate, permissioned action. */
export async function POST(request: Request) {
  const auth = await authorize(request, "property.create");
  if ("response" in auth) return auth.response;
  const { admin, db } = auth;

  try {
    const body = await readJson(request);
    const parsed = parsePropertyDraft(body.property);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const status = can(admin.role, "property.change_availability")
      ? availabilityFromInput((body.property as Record<string, unknown>)?.status)
      : "Available";
    const property = await createDraftProperty(db, admin, parsed.property, {
      now: nowIso(),
      status,
      internalNotes: typeof body.internalNotes === "string" ? body.internalNotes.slice(0, 4000) : "",
    });
    return NextResponse.json({ ok: true, property });
  } catch (error) {
    return errorResponse(error);
  }
}
