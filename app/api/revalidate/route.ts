import { timingSafeEqual } from "node:crypto";

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { getLocationPages } from "@/lib/locations";
import { clearPropertyCache } from "@/lib/properties";

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;

  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-revalidate-secret");
  const expected = process.env.REVALIDATE_SECRET;

  if (!expected || !secretsMatch(secret, expected)) {
    return NextResponse.json(
      { revalidated: false, message: "Invalid secret" },
      { status: 401 },
    );
  }

  clearPropertyCache();

  revalidatePath("/", "layout");
  revalidatePath("/properties");
  revalidatePath("/properties/[slug]", "page");
  revalidatePath("/[location]", "page");
  revalidatePath("/sitemap.xml");

  for (const page of getLocationPages()) {
    revalidatePath(`/${page.slug}`);
  }

  const hook = process.env.NETLIFY_BUILD_HOOK_URL;
  if (hook) {
    await fetch(hook, { method: "POST" }).catch(() => undefined);
  }

  return NextResponse.json({ revalidated: true, timestamp: Date.now() });
}
