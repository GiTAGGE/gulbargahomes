import { NextResponse } from "next/server";

import { authorize, errorResponse, HttpError } from "@/lib/admin/route";
import { nowIso } from "@/lib/db/sql";
import { cancelImportJob, getImportJob, runImportStep } from "@/lib/meta/imports";
import { metaRuntime } from "@/lib/meta/runtime";

export const dynamic = "force-dynamic";

/** Runs the next step. The page calls this while open; the cron sweep continues otherwise. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, "integrations.manage");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    const { runtime } = await metaRuntime(auth.db);
    const job = await runImportStep(runtime, id);
    if (!job) throw new HttpError(404, "Import not found.");
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorize(request, "integrations.manage");
  if ("response" in auth) return auth.response;
  try {
    const { id } = await params;
    await cancelImportJob(auth.db, auth.admin, id, nowIso());
    return NextResponse.json({ ok: true, job: await getImportJob(auth.db, id) });
  } catch (error) {
    return errorResponse(error);
  }
}
