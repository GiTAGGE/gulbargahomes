import { auditStatement, diffFields, type AuditActor } from "../admin/audit";
import { HttpError, isUniqueViolation } from "../admin/errors";
import { formatCode, newId, nextSequence, type SqlDb } from "../db/sql";
import { resolveContact, type ContactInput } from "./contacts";
import { insertSourceStatement, sourceIdForMetaLead, type SourceInput } from "./sources";

export type LandJvAnswer = { key: string; label: string; value: string };

export type LandJvInput = {
  taluk: string;
  village: string;
  acreBand: string;
  ownership: string;
  rtcAvailable: string;
  roadAccess: string;
  ownersAgree: string;
  answers: LandJvAnswer[];
  notes: string;
};

export type LandJvEnquiry = {
  id: string;
  code: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  contactCode: string;
  sourceId: string;
  campaignId: string;
  campaignName: string;
  formId: string;
  formName: string;
  metaLeadId: string;
  submittedAt: string;
  taluk: string;
  village: string;
  acreBand: string;
  ownership: string;
  rtcAvailable: string;
  roadAccess: string;
  ownersAgree: string;
  answers: LandJvAnswer[];
  notes: string;
  status: string;
  createdAt: string;
  rowVersion: number;
};

type LandJvRow = {
  id: string;
  code: string;
  contact_id: string;
  contact_name: string;
  contact_phone: string;
  contact_code: string;
  source_id: string;
  meta_campaign_id: string;
  meta_campaign_name: string;
  meta_form_id: string;
  meta_form_name: string;
  meta_lead_id: string | null;
  submitted_at: string;
  taluk: string;
  village: string;
  acre_band: string;
  ownership: string;
  rtc_available: string;
  road_access: string;
  owners_agree: string;
  answers_json: string;
  notes: string;
  status: string;
  created_at: string;
  row_version: number;
};

const SELECT = `SELECT e.id, e.code, e.contact_id, c.name AS contact_name, c.phone_e164 AS contact_phone, c.code AS contact_code,
  e.source_id, s.meta_campaign_id, s.meta_campaign_name, s.meta_form_id, s.meta_form_name, s.meta_lead_id, s.submitted_at,
  e.taluk, e.village, e.acre_band, e.ownership, e.rtc_available, e.road_access, e.owners_agree, e.answers_json, e.notes,
  e.status, e.created_at, e.row_version
  FROM land_jv_enquiries e
  JOIN contacts c ON c.id = e.contact_id
  JOIN lead_sources s ON s.id = e.source_id`;

function toEnquiry(row: LandJvRow): LandJvEnquiry {
  let answers: LandJvAnswer[] = [];
  try {
    const parsed = JSON.parse(row.answers_json) as unknown;
    if (Array.isArray(parsed)) {
      answers = parsed
        .filter((item): item is LandJvAnswer => Boolean(item) && typeof item === "object")
        .map((item) => ({ key: String(item.key ?? ""), label: String(item.label ?? ""), value: String(item.value ?? "") }))
        .filter((item) => item.key || item.value);
    }
  } catch {
    answers = [];
  }
  return {
    id: row.id,
    code: row.code,
    contactId: row.contact_id,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactCode: row.contact_code,
    sourceId: row.source_id,
    campaignId: row.meta_campaign_id,
    campaignName: row.meta_campaign_name,
    formId: row.meta_form_id,
    formName: row.meta_form_name,
    metaLeadId: row.meta_lead_id ?? "",
    submittedAt: row.submitted_at,
    taluk: row.taluk,
    village: row.village,
    acreBand: row.acre_band,
    ownership: row.ownership,
    rtcAvailable: row.rtc_available,
    roadAccess: row.road_access,
    ownersAgree: row.owners_agree,
    answers,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    rowVersion: Number(row.row_version),
  };
}

/** A land JV enquiry. This never creates a property, an owner lead, or a buyer requirement. */
export async function createLandJvEnquiry(
  db: SqlDb,
  actor: AuditActor,
  contact: ContactInput,
  input: LandJvInput,
  source: SourceInput,
  now: string,
): Promise<LandJvEnquiry> {
  const duplicateSource = await sourceIdForMetaLead(db, source.metaLeadId);
  if (duplicateSource) throw new HttpError(409, "That Meta lead was already imported.");

  const resolved = await resolveContact(db, actor, contact, "land", now);
  const insertSource = insertSourceStatement(db, actor, source, now);
  const id = newId("ljv");
  const code = formatCode("GH-L", await nextSequence(db, "seq_land_jv"));
  const answers = input.answers.slice(0, 40).map((answer) => ({
    key: answer.key.slice(0, 80),
    label: answer.label.slice(0, 160),
    value: answer.value.slice(0, 500),
  }));

  try {
    await db.batch([
      ...resolved.statements,
      insertSource.statement,
      db
        .prepare(
          `INSERT INTO land_jv_enquiries (
             id, code, contact_id, source_id, taluk, village, acre_band, ownership, rtc_available, road_access, owners_agree,
             answers_json, notes, status, created_at, created_by, updated_at, updated_by
           ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'New', ?14, ?15, ?14, ?15)`,
        )
        .bind(
          id,
          code,
          resolved.contactId,
          insertSource.id,
          input.taluk.slice(0, 80),
          input.village.slice(0, 160),
          input.acreBand.slice(0, 80),
          input.ownership.slice(0, 80),
          input.rtcAvailable.slice(0, 40),
          input.roadAccess.slice(0, 40),
          input.ownersAgree.slice(0, 40),
          JSON.stringify(answers),
          input.notes.slice(0, 4000),
          now,
          actor.id,
        ),
      auditStatement(db, {
        actor,
        entityType: "land_jv_enquiry",
        entityId: id,
        entityLabel: `${code} ${contact.name}`,
        action: "create",
        changes: diffFields(
          {},
          { taluk: input.taluk, village: input.village, acre_band: input.acreBand, status: "New" },
        ),
        context: { channel: source.channel, contact_created: resolved.created, contact_id: resolved.contactId, meta_lead_id: source.metaLeadId },
        at: now,
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new HttpError(409, "That contact or Meta lead was just added by someone else. Search before retrying.");
    }
    throw error;
  }
  return (await getLandJvEnquiry(db, id))!;
}

export async function getLandJvEnquiry(db: SqlDb, id: string): Promise<LandJvEnquiry | null> {
  const row = await db.prepare(`${SELECT} WHERE e.id = ?1`).bind(id).first<LandJvRow>();
  return row ? toEnquiry(row) : null;
}

export async function listLandJvEnquiries(
  db: SqlDb,
  filter: { contactId?: string; limit?: number } = {},
): Promise<LandJvEnquiry[]> {
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  const { results } = filter.contactId
    ? await db.prepare(`${SELECT} WHERE e.contact_id = ?1 ORDER BY e.created_at DESC, e.id LIMIT ?2`).bind(filter.contactId, limit).all<LandJvRow>()
    : await db.prepare(`${SELECT} ORDER BY e.created_at DESC, e.id LIMIT ?1`).bind(limit).all<LandJvRow>();
  return results.map(toEnquiry);
}
