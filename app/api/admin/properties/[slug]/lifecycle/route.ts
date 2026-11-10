import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { nowIso } from "@/lib/db/sql";
import { LIFECYCLE_ACTION_PERMISSION, parseLifecycleAction } from "@/lib/inventory/lifecycle";
import { applyPropertyLifecycle, getInventoryBySlug } from "@/lib/inventory/repository";
import { revalidateListings } from "@/lib/revalidate-listings";

type Context = { params: Promise<{ slug: string }> };

export async function POST(request: Request, context: Context) {
  const auth = await authorize(request, "property.view");
  if ("response" in auth) return auth.response;
  const { admin, db } = auth;
  const { slug } = await context.params;

  try {
    const body = await readJson(request);
    const action = parseLifecycleAction(body);
    if (!action) return jsonError(400, "Unknown action.");
    if (!can(admin.role, LIFECYCLE_ACTION_PERMISSION[action.type])) {
      return jsonError(403, "Your role does not allow this.");
    }
    if (action.type === "set_discreet" && !can(admin.role, "property.view_discreet")) {
      return jsonError(403, "Your role does not allow discreet inventory.");
    }

    const current = await getInventoryBySlug(db, slug, {
      includeDiscreet: can(admin.role, "property.view_discreet"),
    });
    if (!current) return jsonError(404, "That property is no longer in the inventory.");

    const expectedVersion = Number.isInteger(body.rowVersion) ? Number(body.rowVersion) : undefined;
    const property = await applyPropertyLifecycle(db, admin, current, action, {
      now: nowIso(),
      expectedVersion,
    });
    revalidateListings();
    return NextResponse.json({ ok: true, property });
  } catch (error) {
    return errorResponse(error);
  }
}
