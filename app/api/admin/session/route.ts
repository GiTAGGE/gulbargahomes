import { NextResponse } from "next/server";

import {
  adminSecretsConfigured,
  adminSessionCookie,
  clearAdminSessionCookie,
  createAdminSessionToken,
  legacyLoginEnabled,
  LEGACY_ADMIN_SUBJECT,
  verifyAdminPassword,
} from "@/lib/admin-session";
import { auditStatement } from "@/lib/admin/audit";
import { LEGACY_ADMIN } from "@/lib/admin/identity";
import { authenticateAdmin } from "@/lib/admin/users";
import { getDatabase } from "@/lib/db/database";
import { nowIso } from "@/lib/db/sql";

export async function POST(request: Request) {
  if (!adminSecretsConfigured()) {
    return NextResponse.json(
      { error: "Admin login is not configured. Set ADMIN_SESSION_SECRET on the Worker." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { email?: unknown; password?: unknown }
    | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const now = nowIso();
  let subject: string | null = null;

  if (email) {
    const db = await getDatabase();
    if (!db) {
      return NextResponse.json({ error: "The admin database is not available." }, { status: 503 });
    }
    const user = await authenticateAdmin(db, email, password, now);
    if (user) subject = user.id;
  } else if (legacyLoginEnabled() && (await verifyAdminPassword(password))) {
    subject = LEGACY_ADMIN_SUBJECT;
    const db = await getDatabase().catch(() => null);
    if (db) {
      await auditStatement(db, {
        actor: LEGACY_ADMIN,
        entityType: "session",
        entityId: LEGACY_ADMIN.id,
        entityLabel: LEGACY_ADMIN.name,
        action: "login",
        at: now,
      })
        .run()
        .catch(() => undefined);
    }
  }

  if (!subject) {
    return NextResponse.json(
      { error: email ? "That email and password do not match an active admin." : "That password is not correct." },
      { status: 401 },
    );
  }

  const token = await createAdminSessionToken(subject);
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
