import { NextResponse } from "next/server";

import { authorize, errorResponse, readJson } from "@/lib/admin/route";
import { nowIso } from "@/lib/db/sql";
import { createImportJob, listImportJobs, parseImportInput, runImportStep } from "@/lib/meta/imports";
import { metaRuntime } from "@/lib/meta/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorize(request, "integrations.view");
  if ("response" in auth) return auth.response;
  try {
    return NextResponse.json({ jobs: await listImportJobs(auth.db) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const auth = await authorize(request, "integrations.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = parseImportInput(await readJson(request), new Date());
    const job = await createImportJob(auth.db, auth.admin, input, nowIso());
    const { runtime } = await metaRuntime(auth.db);
    return NextResponse.json({ ok: true, job: (await runImportStep(runtime, job.id)) ?? job }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
