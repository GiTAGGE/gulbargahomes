import { NextResponse } from "next/server";

import { isAdminAuthenticated } from "@/lib/admin-auth";
import { parsePropertyDraft } from "@/lib/property-input";
import { deleteProperty, getProperty, saveProperty } from "@/lib/properties";
import { revalidateListings } from "@/lib/revalidate-listings";

type Context = { params: Promise<{ slug: string }> };

export async function PATCH(request: Request, context: Context) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { slug } = await context.params;
  const current = await getProperty(slug);
  if (!current) {
    return NextResponse.json({ error: "That property is no longer on the site." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { property?: unknown } | null;
  const parsed = parsePropertyDraft(body?.property);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (parsed.property.slug !== slug) {
    const taken = await getProperty(parsed.property.slug);
    if (taken) {
      return NextResponse.json(
        { error: "Another property already uses that slug." },
        { status: 409 },
      );
    }
  }

  try {
    await saveProperty(parsed.property, slug);
    revalidateListings();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the property.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, property: parsed.property });
}

export async function DELETE(_request: Request, context: Context) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { slug } = await context.params;
  try {
    await deleteProperty(slug);
    revalidateListings();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not delete the property.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
