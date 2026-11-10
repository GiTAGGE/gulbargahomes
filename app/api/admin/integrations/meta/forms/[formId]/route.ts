import { NextResponse } from "next/server";

import { authorize, errorResponse, HttpError, readJson } from "@/lib/admin/route";
import { nowIso } from "@/lib/db/sql";
import { getStoredForm, parseFormSettings, updateFormSettings } from "@/lib/meta/forms";
import { processDue } from "@/lib/meta/ingest";
import { metaRuntime } from "@/lib/meta/runtime";

export const dynamic = "force-dynamic";

/** Classification and field mapping. Saving re-queues leads that were waiting on this form. */
export async function PATCH(request: Request, { params }: { params: Promise<{ formId: string }> }) {
  const auth = await authorize(request, "integrations.manage");
  if ("response" in auth) return auth.response;
  try {
    const { formId } = await params;
    const form = await getStoredForm(auth.db, formId);
    if (!form) throw new HttpError(404, "Form not found. Refresh forms first.");
    const body = await readJson(request);
    const result = await updateFormSettings(auth.db, auth.admin, form, parseFormSettings(body, form), {
      now: nowIso(),
      expectedVersion: typeof body.rowVersion === "number" ? body.rowVersion : undefined,
    });
    if (result.requeued) {
      const { runtime } = await metaRuntime(auth.db);
      await processDue(runtime, { limit: 25, budgetMs: 15_000 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
