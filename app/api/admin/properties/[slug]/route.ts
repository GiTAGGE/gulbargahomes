import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { nowIso } from "@/lib/db/sql";
import {
  applyPropertyLifecycle,
  getInventoryBySlug,
  readPlotDimensions,
  savePlotDimensions,
  updatePropertyContent,
} from "@/lib/inventory/repository";
import { parsePropertyDraft } from "@/lib/property-input";
import { revalidateListings } from "@/lib/revalidate-listings";

type Context = { params: Promise<{ slug: string }> };

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(request, "property.edit");
  if ("response" in auth) return auth.response;
  const { admin, db } = auth;
  const { slug } = await context.params;

  try {
    const access = { includeDiscreet: can(admin.role, "property.view_discreet") };
    const current = await getInventoryBySlug(db, slug, access);
    if (!current) return jsonError(404, "That property is no longer in the inventory.");

    const body = await readJson(request);
    const parsed = parsePropertyDraft(body.property);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

    const expectedVersion = Number.isInteger(body.rowVersion) ? Number(body.rowVersion) : undefined;
    const now = nowIso();
    let property = await updatePropertyContent(db, admin, current, parsed.property, {
      now,
      expectedVersion,
      allowPriceChange: can(admin.role, "property.edit_price"),
      internalNotes: typeof body.internalNotes === "string" ? body.internalNotes.slice(0, 4000) : undefined,
    });
    const plotDimensions = readPlotDimensions(body.plotDimensions);
    if (plotDimensions !== undefined) {
      property = await savePlotDimensions(db, admin, property, plotDimensions, now);
    }
    revalidateListings();
    return NextResponse.json({ ok: true, property });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Kept for existing callers: archives instead of deleting. */
export async function DELETE(request: Request, context: Context) {
  const auth = await authorize(request, "property.archive");
  if ("response" in auth) return auth.response;
  const { admin, db } = auth;
  const { slug } = await context.params;

  try {
    const current = await getInventoryBySlug(db, slug, {
      includeDiscreet: can(admin.role, "property.view_discreet"),
    });
    if (!current) return jsonError(404, "That property is no longer in the inventory.");
    const property = await applyPropertyLifecycle(db, admin, current, { type: "archive" }, { now: nowIso() });
    revalidateListings();
    return NextResponse.json({ ok: true, property });
  } catch (error) {
    return errorResponse(error);
  }
}
