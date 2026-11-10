import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { getContact, redactContact, updateContact } from "@/lib/crm/contacts";
import { expectedVersion } from "@/lib/crm/input";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const auth = await authorize(request, "crm.view");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const contact = await getContact(auth.db, id);
    if (!contact) return jsonError(404, "Contact not found.");
    return NextResponse.json({ contact: redactContact(contact, can(auth.admin.role, "contact.view_phone")) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(request, "crm.edit");
  if ("response" in auth) return auth.response;
  const { admin, db } = auth;
  const { id } = await context.params;
  try {
    const current = await getContact(db, id);
    if (!current) return jsonError(404, "Contact not found.");
    const body = await readJson(request);
    const touchesPhone = ["phone", "altPhone", "whatsapp", "email"].some((field) => body[field] !== undefined);
    if (touchesPhone && !can(admin.role, "contact.view_phone")) {
      return jsonError(403, "Your role cannot change contact numbers.");
    }
    const contact = await updateContact(db, admin, current, body, {
      now: nowIso(),
      expectedVersion: expectedVersion(body.rowVersion),
    });
    return NextResponse.json({ ok: true, contact });
  } catch (error) {
    return errorResponse(error);
  }
}
