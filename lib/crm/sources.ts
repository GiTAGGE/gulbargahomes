import type { AuditActor } from "../admin/audit";
import { newId, parseJson, type SqlDb, type SqlStatement } from "../db/sql";
import { text } from "./input";
import { LEAD_CHANNELS, META_PLATFORMS, oneOf, type LeadChannel } from "./options";

export type LeadSource = {
  id: string;
  channel: LeadChannel;
  platform: string;
  metaLeadId: string | null;
  metaFormId: string;
  metaFormName: string;
  metaCampaignId: string;
  metaCampaignName: string;
  metaAdsetId: string;
  metaAdsetName: string;
  metaAdId: string;
  metaAdName: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  submittedAt: string;
  metaPageId: string;
  metaIsOrganic: boolean | null;
  ingestionOrigin: IngestionOrigin;
  receivedAt: string | null;
  rawPayload: Record<string, unknown>;
};

export const INGESTION_ORIGINS = ["manual", "webhook", "historical_import", "reconciliation", "buyer_recovery"] as const;
export type IngestionOrigin = (typeof INGESTION_ORIGINS)[number];

export type LeadSourceRow = {
  id: string;
  channel: string;
  platform: string;
  meta_lead_id: string | null;
  meta_form_id: string;
  meta_form_name: string;
  meta_campaign_id: string;
  meta_campaign_name: string;
  meta_adset_id: string;
  meta_adset_name: string;
  meta_ad_id: string;
  meta_ad_name: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  submitted_at: string;
  meta_page_id: string | null;
  meta_is_organic: number | null;
  ingestion_origin: string | null;
  received_at: string | null;
  raw_payload_json: string;
};

export function rowToSource(row: LeadSourceRow): LeadSource {
  return {
    id: row.id,
    channel: oneOf(row.channel, LEAD_CHANNELS, "manual"),
    platform: row.platform,
    metaLeadId: row.meta_lead_id,
    metaFormId: row.meta_form_id,
    metaFormName: row.meta_form_name,
    metaCampaignId: row.meta_campaign_id,
    metaCampaignName: row.meta_campaign_name,
    metaAdsetId: row.meta_adset_id,
    metaAdsetName: row.meta_adset_name,
    metaAdId: row.meta_ad_id,
    metaAdName: row.meta_ad_name,
    utmSource: row.utm_source,
    utmMedium: row.utm_medium,
    utmCampaign: row.utm_campaign,
    utmContent: row.utm_content,
    utmTerm: row.utm_term,
    submittedAt: row.submitted_at,
    metaPageId: row.meta_page_id ?? "",
    metaIsOrganic: row.meta_is_organic === null || row.meta_is_organic === undefined ? null : Boolean(row.meta_is_organic),
    ingestionOrigin: oneOf(row.ingestion_origin, INGESTION_ORIGINS, "manual"),
    receivedAt: row.received_at ?? null,
    rawPayload: parseJson<Record<string, unknown>>(row.raw_payload_json, {}),
  };
}

export type SourceInput = {
  channel: LeadChannel;
  platform: string;
  metaLeadId: string | null;
  metaFormId: string;
  metaFormName: string;
  metaCampaignId: string;
  metaCampaignName: string;
  metaAdsetId: string;
  metaAdsetName: string;
  metaAdId: string;
  metaAdName: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  submittedAt: string | null;
  metaPageId?: string;
  metaIsOrganic?: boolean | null;
  ingestionOrigin?: IngestionOrigin;
  receivedAt?: string | null;
  rawPayload?: Record<string, unknown>;
};

export function parseSourceInput(value: unknown): SourceInput {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const submitted = typeof data.submittedAt === "string" ? new Date(data.submittedAt) : null;
  return {
    channel: oneOf(data.channel, LEAD_CHANNELS, "manual"),
    platform: oneOf(data.platform, META_PLATFORMS, ""),
    metaLeadId: text(data.metaLeadId, 64) || null,
    metaFormId: text(data.metaFormId, 64),
    metaFormName: text(data.metaFormName, 160),
    metaCampaignId: text(data.metaCampaignId, 64),
    metaCampaignName: text(data.metaCampaignName, 160),
    metaAdsetId: text(data.metaAdsetId, 64),
    metaAdsetName: text(data.metaAdsetName, 160),
    metaAdId: text(data.metaAdId, 64),
    metaAdName: text(data.metaAdName, 160),
    utmSource: text(data.utmSource, 120),
    utmMedium: text(data.utmMedium, 120),
    utmCampaign: text(data.utmCampaign, 160),
    utmContent: text(data.utmContent, 160),
    utmTerm: text(data.utmTerm, 160),
    submittedAt: submitted && !Number.isNaN(submitted.getTime()) ? submitted.toISOString() : null,
  };
}

export function insertSourceStatement(
  db: SqlDb,
  actor: AuditActor,
  source: SourceInput,
  now: string,
  rawPayload: Record<string, unknown> = {},
): { id: string; statement: SqlStatement } {
  const id = newId("src");
  return {
    id,
    statement: db
      .prepare(
        `INSERT INTO lead_sources (id, channel, platform, meta_lead_id, meta_form_id, meta_form_name, meta_campaign_id, meta_campaign_name, meta_adset_id, meta_adset_name, meta_ad_id, meta_ad_name, utm_source, utm_medium, utm_campaign, utm_content, utm_term, submitted_at, raw_payload_json, created_at, created_by, meta_page_id, meta_is_organic, ingestion_origin, received_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)`,
      )
      .bind(
        id,
        source.channel,
        source.platform,
        source.metaLeadId,
        source.metaFormId,
        source.metaFormName,
        source.metaCampaignId,
        source.metaCampaignName,
        source.metaAdsetId,
        source.metaAdsetName,
        source.metaAdId,
        source.metaAdName,
        source.utmSource,
        source.utmMedium,
        source.utmCampaign,
        source.utmContent,
        source.utmTerm,
        source.submittedAt ?? now,
        JSON.stringify(source.rawPayload ?? rawPayload),
        now,
        actor.id,
        source.metaPageId ?? "",
        source.metaIsOrganic === undefined || source.metaIsOrganic === null ? null : source.metaIsOrganic ? 1 : 0,
        source.ingestionOrigin ?? "manual",
        source.receivedAt ?? null,
      ),
  };
}

export async function getSource(db: SqlDb, id: string | null): Promise<LeadSource | null> {
  if (!id) return null;
  const row = await db.prepare("SELECT * FROM lead_sources WHERE id = ?1").bind(id).first<LeadSourceRow>();
  return row ? rowToSource(row) : null;
}

export async function sourceIdForMetaLead(db: SqlDb, metaLeadId: string | null): Promise<string | null> {
  if (!metaLeadId) return null;
  const row = await db
    .prepare("SELECT id FROM lead_sources WHERE meta_lead_id = ?1")
    .bind(metaLeadId)
    .first<{ id: string }>();
  return row?.id ?? null;
}
