import { NextResponse } from "next/server";

import { authorize, errorResponse, readJson } from "@/lib/admin/route";
import { createAdminUser, listAdminUsers } from "@/lib/admin/users";
import { nowIso } from "@/lib/db/sql";

export async function GET(request: Request) {
  const auth = await authorize(request, "users.manage");
  if ("response" in auth) return auth.response;
  return NextResponse.json({ users: await listAdminUsers(auth.db) });
}

export async function POST(request: Request) {
  const auth = await authorize(request, "users.manage");
  if ("response" in auth) return auth.response;
  try {
    const body = await readJson(request);
    const user = await createAdminUser(
      auth.db,
      auth.admin,
      {
        email: String(body.email ?? ""),
        name: String(body.name ?? ""),
        role: body.role,
        password: String(body.password ?? ""),
      },
      nowIso(),
    );
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return errorResponse(error);
  }
}
