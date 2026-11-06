import { NextResponse } from "next/server";

import {
  adminSecretsConfigured,
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminSessionToken,
  verifyAdminPassword,
} from "@/lib/admin-session";

export async function POST(request: Request) {
  if (!adminSecretsConfigured()) {
    return NextResponse.json(
      {
        error:
          "Admin login is not configured. Set ADMIN_PASSWORD and ADMIN_SESSION_SECRET on the Worker.",
      },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!(await verifyAdminPassword(password))) {
    return NextResponse.json({ error: "That password is not correct." }, { status: 401 });
  }

  const token = await createAdminSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Could not start a session." }, { status: 503 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(adminSessionCookie(token));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(clearAdminSessionCookie());
  return response;
}
