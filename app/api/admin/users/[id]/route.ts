import { NextResponse } from "next/server";

import { authorize, errorResponse, readJson } from "@/lib/admin/route";
import { updateAdminUser } from "@/lib/admin/users";
import { nowIso } from "@/lib/db/sql";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const auth = await authorize(request, "users.manage");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const body = await readJson(request);
    const user = await updateAdminUser(auth.db, auth.admin, id, body, nowIso());
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return errorResponse(error);
  }
}
