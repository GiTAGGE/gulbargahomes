import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { parsePropertyDraft } from "@/lib/property-input";
import { getProperty, saveProperty } from "@/lib/properties";
import { revalidateListings } from "@/lib/revalidate-listings";

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { property?: unknown } | null;
  const parsed = parsePropertyDraft(body?.property);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const existing = await getProperty(parsed.property.slug);
  if (existing) {
    return NextResponse.json(
      { error: "A property with that slug already exists. Open it to edit, or choose another slug." },
      { status: 409 },
    );
  }

  try {
    await saveProperty(parsed.property);
    revalidateListings();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the property.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, property: parsed.property });
}
