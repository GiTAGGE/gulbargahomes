import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";

import {
  ADMIN_COOKIE,
  LEGACY_ADMIN_SUBJECT,
  readAdminSessionToken,
} from "../admin-session";
import { getDatabase } from "../db/database";
import { can, isRole, type Permission, type Role } from "./permissions";

export type AdminIdentity = {
  id: string;
  email: string;
  name: string;
  role: Role;
  legacy: boolean;
};

export const LEGACY_ADMIN: AdminIdentity = {
  id: LEGACY_ADMIN_SUBJECT,
  email: "primary-admin",
  name: "Primary admin",
  role: "super_admin",
  legacy: true,
};

type AdminRow = { id: string; email: string; name: string; role: string; active: number };

export async function adminForSubject(subject: string): Promise<AdminIdentity | null> {
  if (subject === LEGACY_ADMIN_SUBJECT) return LEGACY_ADMIN;
  const db = await getDatabase();
  if (!db) return null;
  const row = await db
    .prepare("SELECT id, email, name, role, active FROM admin_users WHERE id = ?1")
    .bind(subject)
    .first<AdminRow>();
  if (!row || !row.active || !isRole(row.role)) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role, legacy: false };
}

/** The signed-in admin, reloaded from the database on every request. */
export const getCurrentAdmin = cache(async (): Promise<AdminIdentity | null> => {
  const cookieStore = await cookies();
  const session = await readAdminSessionToken(cookieStore.get(ADMIN_COOKIE)?.value);
  if (!session) return null;
  return adminForSubject(session.subject);
});

export function hasPermission(admin: AdminIdentity | null, permission: Permission): boolean {
  return Boolean(admin && can(admin.role, permission));
}

export function adminCapabilities(admin: AdminIdentity) {
  const check = (permission: Permission) => can(admin.role, permission);
  return {
    viewDiscreet: check("property.view_discreet"),
    viewOwnerContact: check("property.view_owner_contact"),
    viewPhone: check("contact.view_phone"),
    createProperty: check("property.create"),
    editProperty: check("property.edit"),
    editPrice: check("property.edit_price"),
    changeAvailability: check("property.change_availability"),
    confirmAvailability: check("property.confirm_availability"),
    verify: check("property.verify"),
    publish: check("property.publish"),
    archive: check("property.archive"),
    editCrm: check("crm.edit"),
    logActivity: check("activity.log"),
    manageFollowups: check("followup.manage"),
    viewAudit: check("audit.view"),
    manageUsers: check("users.manage"),
    viewIntegrations: check("integrations.view"),
    manageIntegrations: check("integrations.manage"),
  };
}

export type AdminCapabilities = ReturnType<typeof adminCapabilities>;
