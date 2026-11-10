import { NextResponse } from "next/server";

import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, HttpError } from "@/lib/admin/route";
import { getIngestionDetail } from "@/lib/meta/overview";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, "integrations.view");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    const detail = await getIngestionDetail(auth.db, id, can(auth.admin.role, "contact.view_phone"));
    if (!detail) throw new HttpError(404, "Not found.");
    return NextResponse.json({ ingestion: detail }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
