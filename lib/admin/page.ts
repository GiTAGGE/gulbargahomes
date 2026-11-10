import "server-only";

import { redirect } from "next/navigation";

import { requireDatabase } from "../db/database";
import { adminCapabilities, getCurrentAdmin } from "./identity";
import { can, type Permission } from "./permissions";

/** For admin server pages: signed in, allowed, with the database ready. */
export async function requirePageAdmin(permission?: Permission) {
  const admin = await getCurrentAdmin();
  if (!admin) redirect("/admin/login");
  if (permission && !can(admin.role, permission)) redirect("/admin/today");
  const db = await requireDatabase();
  return { admin, db, caps: adminCapabilities(admin) };
}
