import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, readJson } from "@/lib/admin/route";
import { parseContactInput } from "@/lib/crm/contacts";
import { redactContactPhone } from "@/lib/crm/redact";
import { createRequirement, listRequirements, parseRequirementInput } from "@/lib/crm/requirements";
import { parseSourceInput } from "@/lib/crm/sources";
import { nowIso } from "@/lib/db/sql";

export async function GET(request: Request) {
  const auth = await authorize(request, "crm.view");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  try {
    const requirements = await listRequirements(auth.db, {
      status: url.searchParams.get("status") ?? "open",
      timeline: url.searchParams.get("timeline") ?? undefined,
      intent: url.searchParams.get("intent") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });
    const canViewPhone = can(auth.admin.role, "contact.view_phone");
    return NextResponse.json({ requirements: requirements.map((item) => redactContactPhone(item, canViewPhone)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, "crm.edit");
  if ("response" in auth) return auth.response;
  try {
    const body = await readJson(request);
    const requirement = await createRequirement(
      auth.db,
      auth.admin,
      parseContactInput(body.contact),
      parseRequirementInput(body.requirement),
      parseSourceInput(body.source),
      nowIso(),
    );
    return NextResponse.json({ ok: true, requirement }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
