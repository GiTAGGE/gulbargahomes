import { auditStatement, diffFields, type AuditActor } from "../admin/audit";
import { HttpError } from "../admin/errors";
import {
  changedRows,
  formatCode,
  newId,
  nextSequence,
  type SqlDb,
  type SqlStatement,
  type SqlValue,
} from "../db/sql";
import { assertVersion, text } from "./input";
import { maskEmail, maskPhone, normalizeIndianMobile } from "./phone";

export type Contact = {
  id: string;
  code: string;
  name: string;
  phone: string;
  altPhone: string;
  whatsapp: string;
  email: string;
  language: string;
  isOwner: boolean;
  isSeeker: boolean;
  doNotContact: boolean;
  doNotContactReason: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
};

type ContactRow = {
  id: string;
  code: string;
  name: string;
  phone_e164: string;
  alt_phone_e164: string;
  whatsapp_e164: string;
  email: string;
  language: string;
  is_owner: number;
  is_seeker: number;
  do_not_contact: number;
  do_not_contact_reason: string;
  notes: string;
  created_at: string;
  updated_at: string;
  row_version: number;
};

function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    phone: row.phone_e164,
    altPhone: row.alt_phone_e164,
    whatsapp: row.whatsapp_e164,
    email: row.email,
    language: row.language,
    isOwner: Boolean(row.is_owner),
    isSeeker: Boolean(row.is_seeker),
    doNotContact: Boolean(row.do_not_contact),
    doNotContactReason: row.do_not_contact_reason,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    rowVersion: Number(row.row_version),
  };
}

/** Server-side masking for roles without `contact.view_phone`. */
export function redactContact(contact: Contact, canViewPhone: boolean): Contact {
  if (canViewPhone) return contact;
  return {
    ...contact,
    phone: maskPhone(contact.phone),
    altPhone: maskPhone(contact.altPhone),
    whatsapp: maskPhone(contact.whatsapp),
    email: maskEmail(contact.email),
  };
}

export async function getContact(db: SqlDb, id: string): Promise<Contact | null> {
  const row = await db.prepare("SELECT * FROM contacts WHERE id = ?1").bind(id).first<ContactRow>();
  return row ? toContact(row) : null;
}

export async function findContactByPhone(db: SqlDb, phone: string): Promise<Contact | null> {
  const e164 = normalizeIndianMobile(phone);
  if (!e164) return null;
  const row = await db.prepare("SELECT * FROM contacts WHERE phone_e164 = ?1").bind(e164).first<ContactRow>();
  return row ? toContact(row) : null;
}

export async function listContacts(db: SqlDb, filter: { q?: string; limit?: number } = {}): Promise<Contact[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const q = filter.q?.trim();
  if (q) {
    const digits = q.replace(/\D/g, "");
    const { results } = await db
      .prepare(
        `SELECT * FROM contacts
         WHERE name LIKE ?1 OR code LIKE ?1 ${digits.length >= 4 ? "OR phone_e164 LIKE ?2 OR alt_phone_e164 LIKE ?2" : ""}
         ORDER BY updated_at DESC LIMIT ?3`,
      )
      .bind(`%${q}%`, `%${digits}%`, limit)
      .all<ContactRow>();
    return results.map(toContact);
  }
  const { results } = await db
    .prepare("SELECT * FROM contacts ORDER BY updated_at DESC LIMIT ?1")
    .bind(limit)
    .all<ContactRow>();
  return results.map(toContact);
}

export type ContactInput = { name: string; phone: string; email?: string };

export function parseContactInput(value: unknown): ContactInput {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const name = text(data.name, 80);
  const phone = normalizeIndianMobile(text(data.phone, 24));
  const email = text(data.email, 120).toLowerCase();
  if (name.length < 2) throw new HttpError(400, "Enter the person’s name.");
  if (!phone) throw new HttpError(400, "Enter a valid 10-digit Indian mobile number.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email or leave it blank.");
  return { name, phone, email };
}

/**
 * Finds the person by mobile number or prepares their insert. One mobile number
 * is one contact, however many leads or properties they bring.
 */
export async function resolveContact(
  db: SqlDb,
  actor: AuditActor,
  input: ContactInput,
  role: "owner" | "seeker",
  now: string,
): Promise<{ contactId: string; created: boolean; statements: SqlStatement[] }> {
  const phone = normalizeIndianMobile(input.phone);
  if (!phone) throw new HttpError(400, "Enter a valid 10-digit Indian mobile number.");
  const flag = role === "owner" ? "is_owner" : "is_seeker";

  const existing = await findContactByPhone(db, phone);
  if (existing) {
    // Set only this role flag, and fill a blank email. The statement reads every
    // other column from the row at write time, so a contact edit that commits
    // after this read keeps its name, number, notes, and the other role flag.
    const email = input.email ?? "";
    return {
      contactId: existing.id,
      created: false,
      statements: [
        db
          .prepare(
            `UPDATE contacts
             SET ${flag} = 1,
                 email = CASE WHEN ?1 <> '' AND email = '' THEN ?1 ELSE email END,
                 updated_at = ?2,
                 updated_by = ?3,
                 row_version = row_version + 1
             WHERE id = ?4 AND (${flag} = 0 OR (?1 <> '' AND email = ''))`,
          )
          .bind(email, now, actor.id, existing.id),
      ],
    };
  }

  const id = newId("con");
  const code = formatCode("GH-C", await nextSequence(db, "seq_contact"));
  return {
    contactId: id,
    created: true,
    statements: [
      db
        .prepare(
          `INSERT INTO contacts (id, code, name, phone_e164, email, ${flag}, created_at, created_by, updated_at, updated_by)
           VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?6, ?7)`,
        )
        .bind(id, code, input.name, phone, input.email ?? "", now, actor.id),
      auditStatement(db, {
        actor,
        entityType: "contact",
        entityId: id,
        entityLabel: `${code} ${input.name}`,
        action: "create",
        changes: diffFields({}, { name: input.name, phone_e164: phone, [flag]: 1 }),
        at: now,
      }),
    ],
  };
}

export async function updateContact(
  db: SqlDb,
  actor: AuditActor,
  current: Contact,
  input: Record<string, unknown>,
  options: { now: string; expectedVersion?: number },
): Promise<Contact> {
  assertVersion(options.expectedVersion, current.rowVersion);
  const next: Record<string, SqlValue> = {};

  if (input.name !== undefined) {
    const name = text(input.name, 80);
    if (name.length < 2) throw new HttpError(400, "Enter the person’s name.");
    next.name = name;
  }
  if (input.phone !== undefined) {
    const phone = normalizeIndianMobile(text(input.phone, 24));
    if (!phone) throw new HttpError(400, "Enter a valid 10-digit Indian mobile number.");
    if (phone !== current.phone) {
      const clash = await findContactByPhone(db, phone);
      if (clash) throw new HttpError(409, `That number already belongs to ${clash.code} ${clash.name}.`);
    }
    next.phone_e164 = phone;
  }
  for (const [field, column] of [
    ["altPhone", "alt_phone_e164"],
    ["whatsapp", "whatsapp_e164"],
  ] as const) {
    if (input[field] !== undefined) {
      const raw = text(input[field], 24);
      const phone = raw ? normalizeIndianMobile(raw) : "";
      if (phone === null) throw new HttpError(400, "Enter a valid 10-digit Indian mobile number.");
      next[column] = phone;
    }
  }
  if (input.email !== undefined) {
    const email = text(input.email, 120).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email.");
    next.email = email;
  }
  if (input.language !== undefined) next.language = text(input.language, 40);
  if (input.notes !== undefined) next.notes = text(input.notes, 4000);
  if (input.doNotContact !== undefined) next.do_not_contact = input.doNotContact === true ? 1 : 0;
  if (input.doNotContactReason !== undefined) next.do_not_contact_reason = text(input.doNotContactReason, 300);

  const before: Record<string, unknown> = {
    name: current.name,
    phone_e164: current.phone,
    alt_phone_e164: current.altPhone,
    whatsapp_e164: current.whatsapp,
    email: current.email,
    language: current.language,
    notes: current.notes,
    do_not_contact: current.doNotContact ? 1 : 0,
    do_not_contact_reason: current.doNotContactReason,
  };
  const changes = diffFields(before, next);
  if (Object.keys(changes).length === 0) return current;

  const names = Object.keys(next);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE contacts SET ${names.map((name, index) => `${name} = ?${index + 1}`).join(", ")},
           updated_at = ?${names.length + 1}, updated_by = ?${names.length + 2}, row_version = row_version + 1
         WHERE id = ?${names.length + 3} AND row_version = ?${names.length + 4}`,
      )
      .bind(...names.map((name) => next[name]), options.now, actor.id, current.id, current.rowVersion),
    auditStatement(db, {
      actor,
      entityType: "contact",
      entityId: current.id,
      entityLabel: `${current.code} ${current.name}`,
      action: "update",
      changes,
      at: options.now,
      onlyIfPreviousChanged: true,
    }),
  ]);
  if (changedRows(results[0]) === 0) {
    throw new HttpError(409, "Someone else changed this contact. Reload to see the latest version.");
  }
  return (await getContact(db, current.id))!;
}
