import { NextResponse } from "next/server";

import { authorize, errorResponse, jsonError, readJson } from "@/lib/admin/route";
import { getFollowup, updateFollowup } from "@/lib/crm/activity";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(request, "followup.manage");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const current = await getFollowup(auth.db, id);
    if (!current) return jsonError(404, "Follow-up not found.");
    const followup = await updateFollowup(auth.db, auth.admin, current, await readJson(request), nowIso());
    return NextResponse.json({ ok: true, followup });
  } catch (error) {
    return errorResponse(error);
  }
}
