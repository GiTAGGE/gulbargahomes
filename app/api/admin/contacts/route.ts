import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse } from "@/lib/admin/route";
import { findContactByPhone, listContacts, redactContact } from "@/lib/crm/contacts";

export async function GET(request: Request) {
  const auth = await authorize(request, "crm.view");
  if ("response" in auth) return auth.response;
  const { admin, db } = auth;
  const url = new URL(request.url);
  const canViewPhone = can(admin.role, "contact.view_phone");

  try {
    const phone = url.searchParams.get("phone");
    if (phone) {
      // Duplicate check while typing a new lead; needs phone access because it confirms a number exists.
      if (!canViewPhone) return NextResponse.json({ contact: null });
      return NextResponse.json({ contact: await findContactByPhone(db, phone) });
    }
    const contacts = await listContacts(db, { q: url.searchParams.get("q") ?? undefined });
    return NextResponse.json({ contacts: contacts.map((contact) => redactContact(contact, canViewPhone)) });
  } catch (error) {
    return errorResponse(error);
  }
}
