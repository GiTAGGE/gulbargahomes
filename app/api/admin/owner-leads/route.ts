import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, readJson } from "@/lib/admin/route";
import { parseContactInput } from "@/lib/crm/contacts";
import { createOwnerLead, listOwnerLeads, parseOwnerLeadInput } from "@/lib/crm/owner-leads";
import { redactContactPhone } from "@/lib/crm/redact";
import { parseSourceInput } from "@/lib/crm/sources";
import { nowIso } from "@/lib/db/sql";

export async function GET(request: Request) {
  const auth = await authorize(request, "crm.view");
  if ("response" in auth) return auth.response;
  const url = new URL(request.url);
  try {
    const leads = await listOwnerLeads(auth.db, {
      status: url.searchParams.get("status") ?? "open",
      q: url.searchParams.get("q") ?? undefined,
    });
    const canViewPhone = can(auth.admin.role, "contact.view_phone");
    return NextResponse.json({ leads: leads.map((lead) => redactContactPhone(lead, canViewPhone)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, "crm.edit");
  if ("response" in auth) return auth.response;
  try {
    const body = await readJson(request);
    const lead = await createOwnerLead(
      auth.db,
      auth.admin,
      parseContactInput(body.contact),
      parseOwnerLeadInput(body.lead),
      parseSourceInput(body.source),
      nowIso(),
    );
    return NextResponse.json({ ok: true, lead }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
