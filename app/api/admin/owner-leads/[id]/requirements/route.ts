import { NextResponse } from "next/server";

import { authorize, errorResponse, readJson } from "@/lib/admin/route";
import { addClientRequirements } from "@/lib/crm/owner-client";
import { parseRequirementInput } from "@/lib/crm/requirements";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

/** Adds a buyer requirement, a tenant requirement, or both, for this owner’s contact. */
export async function POST(request: Request, context: Context) {
  const auth = await authorize(request, "crm.edit");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const body = await readJson(request);
    const mode = body.mode;
    const details = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
    const requirements = [];
    if (mode === "buy" || mode === "both") {
      requirements.push(parseRequirementInput({ ...details(body.buy), intent: "Buy" }));
    }
    if (mode === "rent" || mode === "both") {
      requirements.push(parseRequirementInput({ ...details(body.rent), intent: "Rent" }));
    }
    if (mode !== "buy" && mode !== "rent" && mode !== "both") {
      return NextResponse.json({ error: "Choose buyer, tenant, or both." }, { status: 400 });
    }
    const result = await addClientRequirements(
      auth.db,
      auth.admin,
      id,
      { idempotencyKey: String(body.idempotencyKey ?? ""), requirements },
      nowIso(),
    );
    return NextResponse.json({ ok: true, ...result }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return errorResponse(error);
  }
}
