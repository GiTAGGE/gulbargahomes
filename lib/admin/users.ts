import { newId, type SqlDb } from "../db/sql";
import { auditStatement, type AuditActor } from "./audit";
import { HttpError, isUniqueViolation } from "./errors";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { isRole, type Role } from "./permissions";

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  active: number;
  created_at: string;
  last_login_at: string | null;
  password_hash: string;
  password_salt: string;
  password_iterations: number;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: isRole(row.role) ? row.role : "viewer",
    active: Boolean(row.active),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export async function listAdminUsers(db: SqlDb): Promise<AdminUser[]> {
  const { results } = await db
    .prepare("SELECT * FROM admin_users ORDER BY active DESC, name")
    .all<AdminUserRow>();
  return results.map(toUser);
}

export async function adminNames(db: SqlDb): Promise<Record<string, string>> {
  const { results } = await db.prepare("SELECT id, name FROM admin_users").all<{ id: string; name: string }>();
  return Object.fromEntries(results.map((row) => [row.id, row.name]));
}

/** Returns the user only when the email, password and active flag all check out. */
export async function authenticateAdmin(
  db: SqlDb,
  email: string,
  password: string,
  now: string,
): Promise<AdminUser | null> {
  const row = await db
    .prepare("SELECT * FROM admin_users WHERE email = ?1")
    .bind(email.trim())
    .first<AdminUserRow>();
  if (!row) {
    await hashPassword(password);
    return null;
  }
  const valid = await verifyPassword(password, {
    hash: row.password_hash,
    salt: row.password_salt,
    iterations: row.password_iterations,
  });
  if (!valid || !row.active || !isRole(row.role)) return null;
  const user = toUser(row);
  await db.batch([
    db.prepare("UPDATE admin_users SET last_login_at = ?1 WHERE id = ?2").bind(now, row.id),
    auditStatement(db, {
      actor: { id: user.id, email: user.email, role: user.role },
      entityType: "session",
      entityId: user.id,
      entityLabel: user.name,
      action: "login",
      at: now,
    }),
  ]);
  return user;
}

export async function createAdminUser(
  db: SqlDb,
  actor: AuditActor,
  input: { email: string; name: string; role: unknown; password: string },
  now: string,
): Promise<AdminUser> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!EMAIL_PATTERN.test(email) || email.length > 120) throw new HttpError(400, "Enter a valid email.");
  if (name.length < 2 || name.length > 80) throw new HttpError(400, "Enter the person’s name.");
  if (!isRole(input.role)) throw new HttpError(400, "Choose a role.");
  const problem = passwordProblem(input.password);
  if (problem) throw new HttpError(400, problem);

  const id = newId("adm");
  const password = await hashPassword(input.password);
  try {
    await db.batch([
      db
        .prepare(
          `INSERT INTO admin_users (id, email, name, role, password_hash, password_salt, password_iterations, active, created_at, created_by, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?9, ?8)`,
        )
        .bind(id, email, name, input.role, password.hash, password.salt, password.iterations, now, actor.id),
      auditStatement(db, {
        actor,
        entityType: "admin_user",
        entityId: id,
        entityLabel: name,
        action: "create",
        changes: { email: [null, email], role: [null, input.role] },
        at: now,
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw new HttpError(409, "An admin with that email already exists.");
    throw error;
  }
  const users = await listAdminUsers(db);
  return users.find((user) => user.id === id)!;
}

export async function updateAdminUser(
  db: SqlDb,
  actor: AuditActor,
  id: string,
  input: { role?: unknown; active?: unknown; name?: unknown; password?: unknown },
  now: string,
): Promise<AdminUser> {
  const row = await db.prepare("SELECT * FROM admin_users WHERE id = ?1").bind(id).first<AdminUserRow>();
  if (!row) throw new HttpError(404, "That admin account does not exist.");
  const current = toUser(row);

  const set: Record<string, string | number> = {};
  const changes: Record<string, [unknown, unknown]> = {};

  if (input.role !== undefined) {
    if (!isRole(input.role)) throw new HttpError(400, "Choose a role.");
    if (input.role !== current.role) {
      set.role = input.role;
      changes.role = [current.role, input.role];
    }
  }
  if (input.active !== undefined) {
    const active = input.active === true;
    if (id === actor.id && !active) throw new HttpError(400, "You cannot deactivate your own account.");
    if (active !== current.active) {
      set.active = active ? 1 : 0;
      changes.active = [current.active, active];
    }
  }
  if (typeof input.name === "string" && input.name.trim() && input.name.trim() !== current.name) {
    set.name = input.name.trim().slice(0, 80);
    changes.name = [current.name, set.name];
  }
  if (typeof input.password === "string" && input.password) {
    const problem = passwordProblem(input.password);
    if (problem) throw new HttpError(400, problem);
    const password = await hashPassword(input.password);
    set.password_hash = password.hash;
    set.password_salt = password.salt;
    set.password_iterations = password.iterations;
    changes.password = ["(previous)", "(reset)"];
  }
  if (id === actor.id && set.role && set.role !== "super_admin") {
    throw new HttpError(400, "You cannot remove your own super admin role.");
  }
  if (Object.keys(set).length === 0) return current;

  const names = Object.keys(set);
  await db.batch([
    db
      .prepare(
        `UPDATE admin_users SET ${names.map((name, index) => `${name} = ?${index + 1}`).join(", ")}, updated_at = ?${names.length + 1} WHERE id = ?${names.length + 2}`,
      )
      .bind(...names.map((name) => set[name]), now, id),
    auditStatement(db, {
      actor,
      entityType: "admin_user",
      entityId: id,
      entityLabel: current.name,
      action: "update",
      changes,
      at: now,
    }),
  ]);
  return (await listAdminUsers(db)).find((user) => user.id === id)!;
}
