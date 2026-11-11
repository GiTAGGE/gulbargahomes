import { auditStatement, diffFields, type AuditActor } from "../admin/audit";
import { HttpError, isUniqueViolation } from "../admin/errors";
import type { InventoryProperty } from "../db/property-rows";
import { changedRows, formatCode, newId, nextSequence, type SqlDb, type SqlValue } from "../db/sql";
import { createDraftProperty } from "../inventory/repository";
import { canonicalLocalityName } from "../locality";
import { emptyProperty, slugifyTitle } from "../property-input";
import type { PropertyType } from "../types";
import { resolveContact, type ContactInput } from "./contacts";
import { assertVersion, optionalInt, text } from "./input";
import {
  OWNER_INTENTS,
  OWNER_LEAD_STATUSES,
  PRIORITIES,
  PROPERTY_TYPES,
  oneOf,
  strictOneOf,
  type OwnerIntent,
  type OwnerLeadStatus,
  type Priority,
} from "./options";
import { updateVersionedRecord } from "./records";
import { insertSourceStatement, sourceIdForMetaLead, type SourceInput } from "./sources";

export type OwnerLead = {
  id: string;
  code: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  contactCode: string;
  sourceId: string | null;
  channel: string;
  campaignName: string;
  intent: OwnerIntent;
  propertyType: PropertyType | "";
  locality: string;
  locationText: string;
  expectedPrice: number | null;
  notes: string;
  status: OwnerLeadStatus;
  statusReason: string;
  priority: Priority;
  assignedTo: string | null;
  nextFollowupAt: string | null;
  lastContactedAt: string | null;
  convertedAt: string | null;
  convertedBy: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  rowVersion: number;
};

type OwnerLeadRow = {
  id: string;
  code: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  contact_code: string;
  source_id: string | null;
  channel: string | null;
  campaign_name: string | null;
  intent: string;
  property_type: string;
  locality: string;
  location_text: string;
  expected_price: number | null;
  notes: string;
  status: string;
  status_reason: string;
  priority: string;
  assigned_to: string | null;
  next_followup_at: string | null;
  last_contacted_at: string | null;
  converted_at: string | null;
  converted_by: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  row_version: number;
};

const SELECT = `SELECT l.*, c.name AS contact_name, c.phone_e164 AS contact_phone, c.code AS contact_code,
  s.channel AS channel, s.meta_campaign_name AS campaign_name
  FROM owner_leads l
  JOIN contacts c ON c.id = l.contact_id
  LEFT JOIN lead_sources s ON s.id = l.source_id`;

function toLead(row: OwnerLeadRow): OwnerLead {
  return {
    id: row.id,
    code: row.code,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactCode: row.contact_code,
    sourceId: row.source_id,
    channel: row.channel ?? "manual",
    campaignName: row.campaign_name ?? "",
    intent: oneOf(row.intent, OWNER_INTENTS, "Rent"),
    propertyType: (PROPERTY_TYPES as string[]).includes(row.property_type)
      ? (row.property_type as PropertyType)
      : "",
    locality: row.locality,
    locationText: row.location_text,
    expectedPrice: row.expected_price,
    notes: row.notes,
    status: oneOf(row.status, OWNER_LEAD_STATUSES, "New"),
    statusReason: row.status_reason,
    priority: oneOf(row.priority, PRIORITIES, "Warm"),
    assignedTo: row.assigned_to,
    nextFollowupAt: row.next_followup_at,
    lastContactedAt: row.last_contacted_at,
    convertedAt: row.converted_at,
    convertedBy: row.converted_by,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    rowVersion: Number(row.row_version),
  };
}

export async function getOwnerLead(db: SqlDb, id: string): Promise<OwnerLead | null> {
  const row = await db.prepare(`${SELECT} WHERE l.id = ?1`).bind(id).first<OwnerLeadRow>();
  return row ? toLead(row) : null;
}

export async function listOwnerLeads(
  db: SqlDb,
  filter: { status?: string; q?: string; contactId?: string; limit?: number } = {},
): Promise<OwnerLead[]> {
  const conditions: string[] = [];
  const values: SqlValue[] = [];
  const add = (sql: string, value: SqlValue) => {
    values.push(value);
    conditions.push(sql.replace("?", `?${values.length}`));
  };
  const status = strictOneOf(filter.status, OWNER_LEAD_STATUSES);
  if (status) add("l.status = ?", status);
  if (filter.status === "open") conditions.push("l.status IN ('New', 'Contacted', 'Details pending')");
  if (filter.status === "closed") {
    conditions.push("l.status IN ('Not interested', 'Unreachable', 'Duplicate', 'Invalid')");
  }
  if (filter.contactId) add("l.contact_id = ?", filter.contactId);
  if (filter.q?.trim()) {
    const q = `%${filter.q.trim()}%`;
    values.push(q);
    const n = values.length;
    conditions.push(
      `(c.name LIKE ?${n} OR l.code LIKE ?${n} OR l.locality LIKE ?${n} OR l.location_text LIKE ?${n} OR c.phone_e164 LIKE ?${n})`,
    );
  }
  values.push(Math.min(Math.max(filter.limit ?? 200, 1), 500));
  const { results } = await db
    .prepare(
      `${SELECT} ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY CASE l.priority WHEN 'Hot' THEN 0 WHEN 'Warm' THEN 1 ELSE 2 END, l.created_at DESC
       LIMIT ?${values.length}`,
    )
    .bind(...values)
    .all<OwnerLeadRow>();
  return results.map(toLead);
}

export type OwnerLeadInput = {
  intent: OwnerIntent;
  propertyType: PropertyType | "";
  locality: string;
  locationText: string;
  expectedPrice: number | null;
  notes: string;
  priority: Priority;
};

export function parseOwnerLeadInput(value: unknown): OwnerLeadInput {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const intent = strictOneOf(data.intent, OWNER_INTENTS);
  if (!intent) throw new HttpError(400, "Choose whether the owner wants to rent or sell.");
  const locality = text(data.locality, 80);
  const locationText = text(data.locationText, 200);
  if (!locality && !locationText) throw new HttpError(400, "Add the property’s locality or location.");
  return {
    intent,
    propertyType: strictOneOf(data.propertyType, PROPERTY_TYPES) ?? "",
    locality: locality ? canonicalLocalityName(locality) : "",
    locationText,
    expectedPrice: optionalInt(data.expectedPrice),
    notes: text(data.notes, 4000),
    priority: oneOf(data.priority, PRIORITIES, "Warm"),
  };
}

/** Records the owner's interest. This never creates a property. */
export async function createOwnerLead(
  db: SqlDb,
  actor: AuditActor,
  contact: ContactInput,
  input: OwnerLeadInput,
  source: SourceInput,
  now: string,
): Promise<OwnerLead> {
  const duplicateSource = await sourceIdForMetaLead(db, source.metaLeadId);
  if (duplicateSource) throw new HttpError(409, "That Meta lead was already imported.");

  const resolved = await resolveContact(db, actor, contact, "owner", now);
  const insertSource = insertSourceStatement(db, actor, source, now);
  const id = newId("own");
  const code = formatCode("GH-O", await nextSequence(db, "seq_owner_lead"));

  try {
    await db.batch([
      ...resolved.statements,
      insertSource.statement,
      db
        .prepare(
          `INSERT INTO owner_leads (id, code, contact_id, source_id, intent, property_type, locality, location_text, expected_price, notes, priority, status, created_at, created_by, updated_at, updated_by)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'New', ?12, ?13, ?12, ?13)`,
        )
        .bind(
          id,
          code,
          resolved.contactId,
          insertSource.id,
          input.intent,
          input.propertyType,
          input.locality,
          input.locationText,
          input.expectedPrice,
          input.notes,
          input.priority,
          now,
          actor.id,
        ),
      auditStatement(db, {
        actor,
        entityType: "owner_lead",
        entityId: id,
        entityLabel: `${code} ${contact.name}`,
        action: "create",
        changes: diffFields({}, { intent: input.intent, property_type: input.propertyType, locality: input.locality || input.locationText }),
        context: { channel: source.channel, contact_created: resolved.created, contact_id: resolved.contactId },
        at: now,
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "That contact or Meta lead was just added by someone else. Search before retrying.");
    }
    throw error;
  }
  return (await getOwnerLead(db, id))!;
}

export async function updateOwnerLead(
  db: SqlDb,
  actor: AuditActor,
  current: OwnerLead,
  input: Record<string, unknown>,
  options: { now: string; expectedVersion?: number },
): Promise<OwnerLead> {
  assertVersion(options.expectedVersion, current.rowVersion);
  const next: Record<string, SqlValue> = {};

  if (input.status !== undefined) {
    const status = strictOneOf(input.status, OWNER_LEAD_STATUSES);
    if (!status) throw new HttpError(400, "Choose a valid status.");
    if (status === "Converted") {
      throw new HttpError(400, "Use “Convert to draft property” to convert a lead.");
    }
    if (current.status === "Converted") {
      throw new HttpError(400, "This lead has already been converted to a property.");
    }
    next.status = status;
    next.status_reason = text(input.statusReason, 300);
  }
  if (input.priority !== undefined) next.priority = oneOf(input.priority, PRIORITIES, current.priority);
  if (input.intent !== undefined) {
    const intent = strictOneOf(input.intent, OWNER_INTENTS);
    if (!intent) throw new HttpError(400, "Choose rent or sale.");
    next.intent = intent;
  }
  if (input.propertyType !== undefined) next.property_type = strictOneOf(input.propertyType, PROPERTY_TYPES) ?? "";
  if (input.locality !== undefined) {
    const locality = text(input.locality, 80);
    next.locality = locality ? canonicalLocalityName(locality) : "";
  }
  if (input.locationText !== undefined) next.location_text = text(input.locationText, 200);
  if (input.expectedPrice !== undefined) next.expected_price = optionalInt(input.expectedPrice);
  if (input.notes !== undefined) next.notes = text(input.notes, 4000);

  await updateVersionedRecord(db, actor, {
    table: "owner_leads",
    entityType: "owner_lead",
    id: current.id,
    label: `${current.code} ${current.contactName}`,
    rowVersion: current.rowVersion,
    before: {
      status: current.status,
      status_reason: current.statusReason,
      priority: current.priority,
      intent: current.intent,
      property_type: current.propertyType,
      locality: current.locality,
      location_text: current.locationText,
      expected_price: current.expectedPrice,
      notes: current.notes,
    },
    next,
    now: options.now,
  });
  return (await getOwnerLead(db, current.id))!;
}

/**
 * Explicit admin action: creates an unpublished, unverified draft linked to the
 * owner. A lead can be converted more than once when one owner has several
 * properties.
 */
export async function convertOwnerLead(
  db: SqlDb,
  actor: AuditActor,
  lead: OwnerLead,
  options: { now: string; title?: string; listing?: "Rent" | "Sale" },
): Promise<InventoryProperty> {
  if (["Not interested", "Duplicate", "Invalid"].includes(lead.status)) {
    throw new HttpError(400, `Reopen this lead before converting it (it is marked ${lead.status}).`);
  }
  const propertyType: PropertyType = lead.propertyType || "House";
  const place = lead.locality || lead.locationText;
  // A lease stays a lease on the lead. The public site only has Rent and Sale
  // listings, so staff choose which of those the draft uses. Rent and Sale
  // leads keep their own listing. Nothing here turns a sale into a rent.
  const listing = lead.intent === "Lease" ? options.listing : lead.intent;
  if (listing !== "Rent" && listing !== "Sale") {
    throw new HttpError(
      400,
      "This lead is a lease. Choose whether the draft is published later as a rental listing or a sale listing. The lead stays a lease either way.",
    );
  }
  const offered = lead.intent === "Sale" ? "sale" : lead.intent === "Lease" ? "lease" : "rent";
  const title = text(options.title, 180) || `${propertyType} for ${offered} in ${place}`;
  const base = slugifyTitle(title).slice(0, 64) || "property";
  const suffix = lead.code.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const leaseNote =
    lead.intent === "Lease" ? ` Owner asked for a lease. Staff drafted it as a ${listing === "Rent" ? "rental" : "sale"} listing.` : "";

  const property = await createDraftProperty(
    db,
    actor,
    {
      ...emptyProperty(options.now),
      title,
      slug: `${base}-${suffix}-${Date.now().toString(36).slice(-4)}`,
      listing,
      propertyType,
      bhk: propertyType === "Plot" || propertyType === "Commercial" ? null : 2,
      priceSuffix: listing === "Rent" ? "/month" : "",
      price: lead.expectedPrice ?? 0,
      locality: lead.locality || canonicalLocalityName(lead.locationText.split(",")[0] ?? ""),
      mapQuery: `${place}, Kalaburagi, Karnataka`,
    },
    {
      now: options.now,
      status: "Available",
      ownerContactId: lead.contactId,
      sourceOwnerLeadId: lead.id,
      internalNotes: `${lead.notes ? `From owner lead ${lead.code}: ${lead.notes}` : `From owner lead ${lead.code}`}${leaseNote}`,
    },
  );

  const context = { property_id: property.id, property_code: property.code, listing, owner_intent: lead.intent };
  const label = `${lead.code} ${lead.contactName}`;
  // Not version-checked: the draft already exists, so the lead must follow it.
  const results = await db.batch([
    db
      .prepare(
        `UPDATE owner_leads SET status = 'Converted', converted_at = ?1, converted_by = ?2, updated_at = ?1, updated_by = ?2, row_version = row_version + 1
         WHERE id = ?3 AND status != 'Converted'`,
      )
      .bind(options.now, actor.id, lead.id),
    auditStatement(db, {
      actor,
      entityType: "owner_lead",
      entityId: lead.id,
      entityLabel: label,
      action: "convert",
      changes: { status: [lead.status, "Converted"] },
      context,
      at: options.now,
      onlyIfPreviousChanged: true,
    }),
  ]);
  if (changedRows(results[0]) === 0) {
    await auditStatement(db, {
      actor,
      entityType: "owner_lead",
      entityId: lead.id,
      entityLabel: label,
      action: "convert_additional",
      context,
      at: options.now,
    }).run();
  }
  return property;
}
