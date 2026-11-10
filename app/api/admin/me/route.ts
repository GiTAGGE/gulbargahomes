import { NextResponse } from "next/server";

import { adminCapabilities, getCurrentAdmin } from "@/lib/admin/identity";
import { jsonError } from "@/lib/admin/route";

export async function GET() {
  const admin = await getCurrentAdmin();
  if (!admin) return jsonError(401, "Sign in required.");
  return NextResponse.json({ admin, capabilities: adminCapabilities(admin) });
}
