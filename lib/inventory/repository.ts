import { auditStatement, diffFields, type AuditActor } from "../admin/audit";
import { HttpError, isUniqueViolation } from "../admin/errors";
import {
  contentColumns,
  insertSql,
  lifecycleOf,
  rowToInventory,
  updateSql,
  type InventoryProperty,
  type PropertyRow,
} from "../db/property-rows";
import { changedRows, formatCode, newId, nextSequence, type SqlDb, type SqlValue } from "../db/sql";
import type { Property } from "../types";
import {
  applyLifecycleAction,
  asAvailability,
  isPubliclyVisible,
  type AvailabilityStatus,
  type LifecycleAction,
} from "./lifecycle";

export type InventoryAccess = { includeDiscreet: boolean };

const PRICE_FIELDS = ["price", "price_suffix"];

function visible(property: InventoryProperty, access: InventoryAccess) {
  return access.includeDiscreet || !property.discreetMatching;
}

export async function listInventory(db: SqlDb, access: InventoryAccess): Promise<InventoryProperty[]> {
  const { results } = await db
    .prepare("SELECT * FROM properties ORDER BY updated_at DESC")
    .all<PropertyRow>();
  return results.map(rowToInventory).filter((property) => visible(property, access));
}

async function findRow(db: SqlDb, column: "slug" | "id", value: string) {
  return db.prepare(`SELECT * FROM properties WHERE ${column} = ?1`).bind(value).first<PropertyRow>();
}

export async function getInventoryBySlug(
  db: SqlDb,
  slug: string,
  access: InventoryAccess,
): Promise<InventoryProperty | null> {
  const row = await findRow(db, "slug", slug);
  if (!row) return null;
  const property = rowToInventory(row);
  return visible(property, access) ? property : null;
}

export async function getInventoryById(
  db: SqlDb,
  id: string,
  access: InventoryAccess,
): Promise<InventoryProperty | null> {
  const row = await findRow(db, "id", id);
  if (!row) return null;
  const property = rowToInventory(row);
  return visible(property, access) ? property : null;
}

export async function listInventoryForOwnerLead(db: SqlDb, leadId: string, access: InventoryAccess) {
  const { results } = await db
    .prepare("SELECT * FROM properties WHERE source_owner_lead_id = ?1 ORDER BY created_at")
    .bind(leadId)
    .all<PropertyRow>();
  return results.map(rowToInventory).filter((property) => visible(property, access));
}

export async function listInventoryForContact(db: SqlDb, contactId: string, access: InventoryAccess) {
  const { results } = await db
    .prepare("SELECT * FROM properties WHERE owner_contact_id = ?1 ORDER BY created_at")
    .bind(contactId)
    .all<PropertyRow>();
  return results.map(rowToInventory).filter((property) => visible(property, access));
}

async function assertSlugFree(db: SqlDb, slug: string) {
  if (await findRow(db, "slug", slug)) {
    throw new HttpError(409, "Another property already uses that slug. Choose another.");
  }
}

/** Every new property starts as an unpublished draft. */
export async function createDraftProperty(
  db: SqlDb,
  actor: AuditActor,
  property: Property,
  options: {
    now: string;
    status?: AvailabilityStatus;
    ownerContactId?: string | null;
    sourceOwnerLeadId?: string | null;
    internalNotes?: string;
  },
): Promise<InventoryProperty> {
  await assertSlugFree(db, property.slug);
  const id = newId("prp");
  const code = formatCode("GH-P", await nextSequence(db, "seq_property"));
  const columns: Record<string, SqlValue> = {
    ...contentColumns(property),
    status: options.status ?? "Available",
    updated_at: options.now,
    id,
    code,
    verification_status: "Draft",
    publication_status: "Unpublished",
    discreet_matching: 0,
    owner_contact_id: options.ownerContactId ?? null,
    source_owner_lead_id: options.sourceOwnerLeadId ?? null,
    internal_notes: options.internalNotes ?? "",
    created_at: options.now,
    created_by: actor.id,
    updated_by: actor.id,
  };
  const insert = insertSql("properties", columns);
  try {
    await db.batch([
      db.prepare(insert.sql).bind(...insert.values),
      auditStatement(db, {
        actor,
        entityType: "property",
        entityId: id,
        entityLabel: `${code} ${property.title}`,
        action: "create",
        changes: diffFields({}, { title: property.title, slug: property.slug, price: property.price, status: columns.status }),
        context: {
          source_owner_lead_id: options.sourceOwnerLeadId ?? null,
          owner_contact_id: options.ownerContactId ?? null,
        },
        at: options.now,
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "Another property already uses that slug. Choose another.");
    }
    throw error;
  }
  const created = await getInventoryById(db, id, { includeDiscreet: true });
  if (!created) throw new Error("Property was not saved.");
  return created;
}

async function commitUpdate(
  db: SqlDb,
  actor: AuditActor,
  current: InventoryProperty,
  columns: Record<string, SqlValue>,
  audit: { action: string; changes: ReturnType<typeof diffFields>; context?: Record<string, SqlValue | boolean> },
  now: string,
): Promise<InventoryProperty> {
  const update = updateSql(
    "properties",
    { ...columns, updated_at: now, updated_by: actor.id, row_version: current.rowVersion + 1 },
    { id: current.id, row_version: current.rowVersion },
  );
  let results: unknown[];
  try {
    results = await db.batch([
      db.prepare(update.sql).bind(...update.values),
      auditStatement(db, {
        actor,
        entityType: "property",
        entityId: current.id,
        entityLabel: `${current.code} ${String(columns.title ?? current.title)}`,
        action: audit.action,
        changes: audit.changes,
        context: audit.context,
        at: now,
        onlyIfPreviousChanged: true,
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "Another property already uses that slug. Choose another.");
    }
    throw error;
  }
  if (changedRows(results[0]) === 0) {
    throw new HttpError(409, "Someone else changed this property. Reload to see the latest version.");
  }
  const updated = await getInventoryById(db, current.id, { includeDiscreet: true });
  if (!updated) throw new Error("Property was not saved.");
  return updated;
}

function currentContent(property: InventoryProperty): Record<string, SqlValue> {
  return contentColumns({ ...property, status: "Available" } as Property);
}

/** Saves editor fields. Lifecycle state is untouched; that goes through lifecycle actions. */
export async function updatePropertyContent(
  db: SqlDb,
  actor: AuditActor,
  current: InventoryProperty,
  next: Property,
  options: { now: string; expectedVersion?: number; allowPriceChange: boolean; internalNotes?: string },
): Promise<InventoryProperty> {
  if (current.publicationStatus === "Archived") {
    throw new HttpError(409, "Restore this property from the archive before editing it.");
  }
  if (options.expectedVersion !== undefined && options.expectedVersion !== current.rowVersion) {
    throw new HttpError(409, "Someone else changed this property. Reload to see the latest version.");
  }
  if (next.slug !== current.slug) await assertSlugFree(db, next.slug);

  const before = currentContent(current);
  const after = contentColumns(next);
  const changes = diffFields(before, after);
  if (!options.allowPriceChange && PRICE_FIELDS.some((field) => field in changes)) {
    throw new HttpError(403, "Your role cannot change prices.");
  }

  const columns: Record<string, SqlValue> = { ...after };
  if (options.internalNotes !== undefined && options.internalNotes !== current.internalNotes) {
    columns.internal_notes = options.internalNotes;
    changes.internal_notes = ["(previous note)", "(updated note)"];
  }
  if (Object.keys(changes).length === 0) return current;

  return commitUpdate(
    db,
    actor,
    current,
    columns,
    {
      action: PRICE_FIELDS.some((field) => field in changes) ? "update_with_price_change" : "update",
      changes,
      context: { publicly_visible: isPubliclyVisible(lifecycleOf(current)) },
    },
    options.now,
  );
}

export async function applyPropertyLifecycle(
  db: SqlDb,
  actor: AuditActor,
  current: InventoryProperty,
  action: LifecycleAction,
  options: { now: string; expectedVersion?: number },
): Promise<InventoryProperty> {
  if (options.expectedVersion !== undefined && options.expectedVersion !== current.rowVersion) {
    throw new HttpError(409, "Someone else changed this property. Reload to see the latest version.");
  }
  const result = applyLifecycleAction(lifecycleOf(current), action, {
    actorId: actor.id,
    now: options.now,
    firstPublishedAt: current.firstPublishedAt,
  });
  if (!result.ok) throw new HttpError(400, result.error);

  const before: Record<string, unknown> = {
    verification_status: current.verificationStatus,
    publication_status: current.publicationStatus,
    status: current.status,
    discreet_matching: current.discreetMatching ? 1 : 0,
    rejection_reason: current.rejectionReason,
    availability_verified_at: current.availabilityVerifiedAt,
    availability_valid_days: current.availabilityValidDays,
    availability_expires_at: current.availabilityExpiresAt,
  };
  const changes = diffFields(before, result.patch as Record<string, unknown>);
  if (action.type === "confirm_availability" && Object.keys(changes).length === 0) {
    changes.availability_verified_at = [current.availabilityVerifiedAt, options.now];
  }

  return commitUpdate(
    db,
    actor,
    current,
    result.patch as Record<string, SqlValue>,
    {
      action: action.type,
      changes,
      context: {
        publicly_visible_before: isPubliclyVisible(lifecycleOf(current)),
        publicly_visible_after: isPubliclyVisible(result.next),
      },
    },
    options.now,
  );
}

export async function linkPropertyOwner(
  db: SqlDb,
  actor: AuditActor,
  current: InventoryProperty,
  ownerContactId: string | null,
  now: string,
): Promise<InventoryProperty> {
  if (current.ownerContactId === ownerContactId) return current;
  return commitUpdate(
    db,
    actor,
    current,
    { owner_contact_id: ownerContactId },
    { action: "link_owner", changes: { owner_contact_id: [current.ownerContactId, ownerContactId] } },
    now,
  );
}

export function availabilityFromInput(value: unknown): AvailabilityStatus {
  return asAvailability(value);
}
