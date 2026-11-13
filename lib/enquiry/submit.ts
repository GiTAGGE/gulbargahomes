import { auditStatement, type AuditActor } from "../admin/audit";
import { HttpError, isUniqueViolation } from "../admin/errors";
import { changedRows, formatCode, newId, nextSequence, type SqlDb, type SqlStatement } from "../db/sql";
import { text } from "../crm/input";
import { createLandJvEnquiry, type LandJvAnswer } from "../crm/land-jv";
import { createOwnerLead, parseOwnerLeadInput } from "../crm/owner-leads";
import { normalizeContactPhone, normalizeIndianMobile } from "../crm/phone";
import { createRequirement, parseRequirementInput } from "../crm/requirements";
import type { SourceInput } from "../crm/sources";
import { PROPERTY_TYPES, TIMELINES, type Priority, type Timeline } from "../crm/options";
import { classifyTouch, readTouch, type ClassifiedTouch, type TouchEvidence } from "./attribution";
import { parseWebsitePreferences } from "./questions";
import { rememberVisit } from "./capture";
import { mergeSignedAttribution, openAttribution } from "./cookie";

export const WEBSITE_ACTOR: AuditActor = { id: "website_enquiry", email: "website-enquiry", role: "system" };

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 8;
const CLAIM_MS = 30_000;

export type EnquiryKind = "requirement" | "owner" | "land_jv";

export type EnquiryResult = {
  ok: true;
  kind: EnquiryKind;
  id: string;
  code: string;
  conversionChannel: "website" | "whatsapp";
  summary: string;
  replayed: boolean;
};

type EnquiryOptions = {
  now: string;
  ipHash: string;
  idempotencyKey: string;
  humanVerified: boolean;
  rateLimit?: number;
  attributionCookie?: string | null;
  attributionSecret?: string | null;
};

const TARGET = {
  requirement: { table: "demand_requirements", entityType: "requirement", prefix: "req", codePrefix: "GH-D", sequence: "seq_requirement" },
  owner: { table: "owner_leads", entityType: "owner_lead", prefix: "own", codePrefix: "GH-O", sequence: "seq_owner_lead" },
  land_jv: { table: "land_jv_enquiries", entityType: "land_jv_enquiry", prefix: "ljv", codePrefix: "GH-L", sequence: "seq_land_jv" },
} as const;

type KeyRow = {
  kind: string;
  entity_type: string;
  entity_id: string;
  entity_code: string;
  planned_entity_id: string;
  planned_entity_code: string;
  claim_token: string;
  claim_expires: string;
};

function claimExpiry(): string {
  return new Date(Date.now() + CLAIM_MS).toISOString();
}

function hasEvidence(touch: TouchEvidence): boolean {
  return Boolean(
    touch.utmSource ||
      touch.utmMedium ||
      touch.utmCampaign ||
      touch.utmCampaignId ||
      touch.utmTerm ||
      touch.utmContent ||
      touch.gclid ||
      touch.gbraid ||
      touch.wbraid ||
      touch.fbclid ||
      touch.referrer ||
      touch.landingPage,
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Send the enquiry as JSON.");
  return value as Record<string, unknown>;
}

function phoneFromParts(countryCode: unknown, national: unknown): string {
  const country = text(countryCode, 4).replace(/\D/g, "");
  const local = text(national, 20).replace(/\D/g, "");
  if (!/^[1-9]\d{0,2}$/.test(country)) throw new HttpError(400, "Enter a valid country code.");
  if (country === "91") {
    const phone = normalizeIndianMobile(local);
    if (!phone) throw new HttpError(400, "Enter a valid 10-digit Indian mobile number.");
    return phone;
  }
  const phone = normalizeContactPhone(`+${country}${local}`);
  if (!phone) throw new HttpError(400, "Enter a valid mobile number.");
  return phone;
}

function emailOf(value: unknown): string {
  const email = text(value, 120).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Enter a valid email or leave it blank.");
  return email;
}

function nameOf(value: unknown): string {
  const name = text(value, 80);
  if (name.length < 2) throw new HttpError(400, "Enter your name.");
  return name;
}

function conversionOf(value: unknown): "website" | "whatsapp" {
  return value === "whatsapp" ? "whatsapp" : "website";
}

function privacyOf(value: unknown): boolean {
  if (value !== true) throw new HttpError(400, "Acknowledge the Privacy Policy before sending.");
  return true;
}

function slugOf(value: unknown): string {
  const slug = text(value, 80);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : "";
}

async function attributionOf(body: Record<string, unknown>, now: string, cookie: string | null, secret: string | null) {
  const raw = asRecord(body.attribution ?? {});
  const signed = await openAttribution(cookie, secret ?? "", now);
  const submittedLast = readTouch(raw.last);
  const memory = signed
    ? mergeSignedAttribution(signed, hasEvidence(submittedLast) ? submittedLast : signed.last, now)
    : rememberVisit(rememberVisit(null, readTouch(raw.first), now), submittedLast, now);
  const first = classifyTouch(memory.first, now);
  const last = classifyTouch(memory.last, now);
  return {
    first,
    last,
    enquiryPage: pagePath(raw.enquiryPage),
    cta: text(raw.cta, 80).replace(/[\u0000-\u001F]/g, ""),
    propertySlug: slugOf(raw.propertySlug),
    propertyTitle: text(raw.propertyTitle, 120),
    listingIntent: raw.listingIntent === "Buy" || raw.listingIntent === "Rent" ? raw.listingIntent : "",
    listingLocality: text(raw.listingLocality, 80),
    firstTouchVerified: Boolean(signed),
  };
}

function pagePath(value: unknown): string {
  const raw = text(value, 500);
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.pathname}${url.search}`.slice(0, 500);
  } catch {
    return "";
  }
}

function sourceFor(channel: "website" | "whatsapp", last: ClassifiedTouch, now: string): SourceInput {
  return {
    channel,
    platform: "",
    metaLeadId: null,
    metaFormId: "",
    metaFormName: "",
    metaCampaignId: "",
    metaCampaignName: "",
    metaAdsetId: "",
    metaAdsetName: "",
    metaAdId: "",
    metaAdName: "",
    utmSource: last.source,
    utmMedium: last.medium,
    utmCampaign: last.campaign,
    utmContent: last.content,
    utmTerm: last.term,
    submittedAt: now,
    ingestionOrigin: "manual",
    receivedAt: now,
    rawPayload: { acquisition: last.source, conversion: channel },
  };
}

function ownerPriority(timeline: Timeline): Priority {
  if (timeline === "Immediate" || timeline === "Within 7 days") return "Hot";
  if (timeline === "Within 30 days") return "Warm";
  return "Cold";
}

async function assertRate(db: SqlDb, ipHash: string, now: string, limit: number) {
  const since = new Date(new Date(now).getTime() - RATE_WINDOW_MS).toISOString();
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM public_enquiry_attempts WHERE ip_hash = ?1 AND created_at >= ?2")
    .bind(ipHash, since)
    .first<{ n: number }>();
  if (Number(row?.n ?? 0) >= limit) throw new HttpError(429, "Too many enquiries from this connection. Try again later.");
  await db.prepare("INSERT INTO public_enquiry_attempts (id, ip_hash, created_at) VALUES (?1, ?2, ?3)").bind(newId("pea"), ipHash, now).run();
}

type EnquiryAttribution = Awaited<ReturnType<typeof attributionOf>>;

function attributionStatements(
  db: SqlDb,
  kind: EnquiryKind,
  entityId: string,
  code: string,
  idempotencyKey: string,
  attribution: EnquiryAttribution,
  channel: "website" | "whatsapp",
  marketingConsent: boolean,
  now: string,
): SqlStatement[] {
  const target = TARGET[kind];
  const first = attribution.first;
  const last = attribution.last;
  return [
    db
      .prepare(
        `INSERT INTO acquisition_attributions (
           id, entity_type, entity_id,
           first_source, first_medium, first_campaign, first_campaign_id, first_term, first_content, first_landing_page, first_referrer, first_referrer_domain, first_seen_at,
           last_source, last_medium, last_campaign, last_campaign_id, last_term, last_content, last_landing_page, last_referrer, last_referrer_domain, last_seen_at,
           referrer_domain, enquiry_page, conversion_channel, cta_placement, property_slug, property_title, listing_intent, listing_locality,
           gclid, gbraid, wbraid, fbclid, fbp, fbc, marketing_consent, first_touch_verified, created_at
         ) VALUES (${Array.from({ length: 40 }, (_, index) => `?${index + 1}`).join(", ")})`,
      )
      .bind(
        newId("acq"),
        target.entityType,
        entityId,
        first.source,
        first.medium,
        first.campaign,
        first.campaignId,
        first.term,
        first.content,
        first.landingPage,
        first.referrer,
        first.referrerDomain,
        first.seenAt,
        last.source,
        last.medium,
        last.campaign,
        last.campaignId,
        last.term,
        last.content,
        last.landingPage,
        last.referrer,
        last.referrerDomain,
        last.seenAt,
        last.referrerDomain,
        attribution.enquiryPage,
        channel,
        attribution.cta,
        attribution.propertySlug,
        attribution.propertyTitle,
        attribution.listingIntent,
        attribution.listingLocality,
        last.gclid || first.gclid,
        last.gbraid || first.gbraid,
        last.wbraid || first.wbraid,
        last.fbclid || first.fbclid,
        last.fbp || first.fbp,
        last.fbc || first.fbc,
        marketingConsent ? 1 : 0,
        attribution.firstTouchVerified ? 1 : 0,
        now,
      ),
    auditStatement(db, {
      actor: WEBSITE_ACTOR,
      entityType: target.entityType,
      entityId,
      action: "attribute",
      context: { first_source: first.source, last_source: last.source, conversion_channel: channel, first_touch_verified: attribution.firstTouchVerified },
      at: now,
    }),
    db
      .prepare(
        `UPDATE public_enquiry_keys
         SET entity_type = ?2, entity_id = ?3, entity_code = ?4, claim_token = '', claim_expires = ''
         WHERE idempotency_key = ?1 AND entity_id = ''`,
      )
      .bind(idempotencyKey, target.entityType, entityId, code),
  ];
}

async function readKey(db: SqlDb, key: string): Promise<KeyRow | null> {
  return db
    .prepare(
      `SELECT kind, entity_type, entity_id, entity_code, planned_entity_id, planned_entity_code, claim_token, claim_expires
       FROM public_enquiry_keys WHERE idempotency_key = ?1`,
    )
    .bind(key)
    .first<KeyRow>();
}

async function crmCode(db: SqlDb, kind: EnquiryKind, id: string): Promise<string | null> {
  const row = await db.prepare(`SELECT code FROM ${TARGET[kind].table} WHERE id = ?1`).bind(id).first<{ code: string }>();
  return row?.code ?? null;
}

async function storedChannel(db: SqlDb, kind: EnquiryKind, id: string): Promise<"website" | "whatsapp" | null> {
  const row = await db
    .prepare("SELECT conversion_channel FROM acquisition_attributions WHERE entity_type = ?1 AND entity_id = ?2")
    .bind(TARGET[kind].entityType, id)
    .first<{ conversion_channel: string }>();
  if (!row) return null;
  return row.conversion_channel === "whatsapp" ? "whatsapp" : "website";
}

function replay(kind: EnquiryKind, id: string, code: string, channel: "website" | "whatsapp"): EnquiryResult {
  return { ok: true, kind, id, code, conversionChannel: channel, summary: code, replayed: true };
}

async function ensureAttribution(
  db: SqlDb,
  kind: EnquiryKind,
  id: string,
  code: string,
  idempotencyKey: string,
  attribution: EnquiryAttribution,
  channel: "website" | "whatsapp",
  marketingConsent: boolean,
  now: string,
) {
  const existing = await storedChannel(db, kind, id);
  const statements = existing
    ? [
        db
          .prepare(
            `UPDATE public_enquiry_keys
             SET entity_type = ?2, entity_id = ?3, entity_code = ?4, claim_token = '', claim_expires = ''
             WHERE idempotency_key = ?1 AND entity_id = ''`,
          )
          .bind(idempotencyKey, TARGET[kind].entityType, id, code),
      ]
    : attributionStatements(db, kind, id, code, idempotencyKey, attribution, channel, marketingConsent, now);
  await db.batch(statements);
  return existing ?? channel;
}

async function clearClaim(db: SqlDb, key: string, token: string) {
  await db
    .prepare(
      "UPDATE public_enquiry_keys SET claim_token = '', claim_expires = '' WHERE idempotency_key = ?1 AND claim_token = ?2 AND entity_id = ''",
    )
    .bind(key, token)
    .run();
}

async function allocate(db: SqlDb, kind: EnquiryKind, key: string, token: string): Promise<{ id: string; code: string; token: string }> {
  const target = TARGET[kind];
  const id = newId(target.prefix);
  const code = formatCode(target.codePrefix, await nextSequence(db, target.sequence));
  const updated = await db
    .prepare(
      `UPDATE public_enquiry_keys
       SET planned_entity_id = ?1, planned_entity_code = ?2
       WHERE idempotency_key = ?3 AND claim_token = ?4 AND planned_entity_id = '' AND entity_id = ''`,
    )
    .bind(id, code, key, token)
    .run();
  if (changedRows(updated) !== 1) throw new HttpError(409, "This enquiry is already being submitted.");
  return { id, code, token };
}

async function claim(
  db: SqlDb,
  kind: EnquiryKind,
  options: EnquiryOptions,
  attribution: EnquiryAttribution,
  channel: "website" | "whatsapp",
  marketingConsent: boolean,
): Promise<EnquiryResult | { id: string; code: string; token: string }> {
  if (!KEY_PATTERN.test(options.idempotencyKey)) throw new HttpError(400, "Send a submission key.");
  const key = options.idempotencyKey;
  const row = await readKey(db, key);
  if (row) {
    if (row.kind !== kind) throw new HttpError(409, "That submission key was already used.");
    const linkedId = row.entity_id || row.planned_entity_id;
    if (linkedId) {
      const code = (await crmCode(db, kind, linkedId)) || row.entity_code || row.planned_entity_code;
      if (await crmCode(db, kind, linkedId)) {
        const stored = await ensureAttribution(db, kind, linkedId, code, key, attribution, channel, marketingConsent, options.now);
        return replay(kind, linkedId, code, stored);
      }
    }
    if (row.planned_entity_id) {
      const token = newId("clm");
      const wall = new Date().toISOString();
      const taken = await db
        .prepare(
          `UPDATE public_enquiry_keys SET claim_token = ?1, claim_expires = ?2
           WHERE idempotency_key = ?3 AND entity_id = '' AND planned_entity_id = ?4
             AND (claim_token = '' OR (claim_expires != '' AND claim_expires < ?5))`,
        )
        .bind(token, claimExpiry(), key, row.planned_entity_id, wall)
        .run();
      if (changedRows(taken) !== 1) throw new HttpError(409, "This enquiry is already being submitted.");
      return { id: row.planned_entity_id, code: row.planned_entity_code, token };
    }
    const token = newId("clm");
    const wall = new Date().toISOString();
    const taken = await db
      .prepare(
        `UPDATE public_enquiry_keys SET claim_token = ?1, claim_expires = ?2
         WHERE idempotency_key = ?3 AND entity_id = '' AND planned_entity_id = ''
           AND (claim_token = '' OR (claim_expires != '' AND claim_expires < ?4))`,
      )
      .bind(token, claimExpiry(), key, wall)
      .run();
    if (changedRows(taken) !== 1) throw new HttpError(409, "This enquiry is already being submitted.");
    return allocate(db, kind, key, token);
  }

  await assertRate(db, options.ipHash, options.now, options.rateLimit ?? RATE_LIMIT);
  const token = newId("clm");
  try {
    await db
      .prepare(
        `INSERT INTO public_enquiry_keys (
           id, idempotency_key, kind, entity_type, entity_id, entity_code, planned_entity_id, planned_entity_code, claim_token, claim_expires, created_at
         ) VALUES (?1, ?2, ?3, '', '', '', '', '', ?4, ?5, ?6)`,
      )
      .bind(newId("pek"), key, kind, token, claimExpiry(), options.now)
      .run();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return claim(db, kind, options, attribution, channel, marketingConsent);
  }
  return allocate(db, kind, key, token);
}

function guard(body: Record<string, unknown>, options: EnquiryOptions) {
  if (text(body.company, 200) || text(body.website, 200)) throw new HttpError(400, "This enquiry could not be submitted.");
  privacyOf(body.privacyAccepted);
  if (!options.humanVerified) throw new HttpError(403, "The enquiry check failed. Please try again.");
  if (!options.ipHash) throw new HttpError(400, "The enquiry could not be submitted.");
}

async function guarded(
  db: SqlDb,
  kind: EnquiryKind,
  body: Record<string, unknown>,
  options: EnquiryOptions,
  create: (planned: { id: string; code: string }, alongside: SqlStatement[]) => Promise<{ id: string; code: string }>,
  summary: (created: { id: string; code: string }) => string,
  channel: "website" | "whatsapp",
  attribution: EnquiryAttribution,
): Promise<EnquiryResult> {
  guard(body, options);
  const marketingConsent = body.marketingConsent === true;
  const claimed = await claim(db, kind, options, attribution, channel, marketingConsent);
  if ("ok" in claimed) return claimed;
  try {
    const alongside = attributionStatements(
      db,
      kind,
      claimed.id,
      claimed.code,
      options.idempotencyKey,
      attribution,
      channel,
      marketingConsent,
      options.now,
    );
    const created = await create(claimed, alongside);
    console.info("website enquiry stored", { kind, code: created.code, source: attribution.last.source, channel });
    return { ok: true, kind, id: created.id, code: created.code, conversionChannel: channel, summary: summary(created), replayed: false };
  } catch (error) {
    const code = await crmCode(db, kind, claimed.id);
    if (code) {
      const stored = await ensureAttribution(db, kind, claimed.id, code, options.idempotencyKey, attribution, channel, marketingConsent, options.now);
      console.info("website enquiry recovered", { kind, code, source: attribution.last.source, channel: stored });
      return { ok: true, kind, id: claimed.id, code, conversionChannel: stored, summary: summary({ id: claimed.id, code }), replayed: true };
    }
    await clearClaim(db, options.idempotencyKey, claimed.token);
    console.error("website enquiry failed", { kind, message: error instanceof Error ? error.message : "failed" });
    throw error;
  }
}

export async function submitRequirementEnquiry(db: SqlDb, value: unknown, options: EnquiryOptions): Promise<EnquiryResult> {
  const body = asRecord(value);
  const channel = conversionOf(body.conversionChannel);
  const attribution = await attributionOf(body, options.now, options.attributionCookie ?? null, options.attributionSecret ?? null);
  const propertyType = PROPERTY_TYPES.find((type) => type === body.propertyType);
  if (!propertyType) throw new HttpError(400, "Choose a property type.");
  const structured = Object.prototype.hasOwnProperty.call(body, "preferences");
  const intent = body.intent === "Buy" || body.intent === "Rent" ? body.intent : null;
  if (structured && !intent) throw new HttpError(400, "Choose whether they want to rent or buy.");
  const preferences = structured && intent ? parseWebsitePreferences(intent, propertyType, body.preferences) : null;
  const bhkRelevant = propertyType !== "Plot" && propertyType !== "Commercial";
  const parsed = parseRequirementInput({
    intent: body.intent,
    propertyTypes: [propertyType],
    bhkMin: preferences ? preferences.bhkMin : bhkRelevant ? body.bhkMin : null,
    bhkMax: preferences ? preferences.bhkMax : bhkRelevant ? body.bhkMax : null,
    budgetMin: body.budgetMin,
    budgetMax: body.budgetMax,
    localities: body.localities,
    localityFlexible: body.localityFlexible === true,
    areaMin: preferences ? preferences.areaMin : body.areaMin,
    furnishing: preferences ? preferences.furnishing : body.furnishing,
    tenantProfile: preferences ? preferences.tenantProfile : body.tenantProfile,
    parkingRequired: preferences ? preferences.parkingRequired : body.parkingRequired === true,
    timeline: body.timeline,
    notes: preferences ? preferences.notes : "",
  });
  if (preferences) parsed.preferenceDetails = preferences.details;
  if (!parsed.localities.length) throw new HttpError(400, "Add at least one locality.");
  const contact = { name: nameOf(body.name), phone: phoneFromParts(body.countryCode, body.mobile), email: emailOf(body.email) };
  return guarded(
    db,
    "requirement",
    body,
    options,
    (planned, alongside) =>
      createRequirement(db, WEBSITE_ACTOR, contact, parsed, sourceFor(channel, attribution.last, options.now), options.now, {
        id: planned.id,
        code: planned.code,
        alongside,
      }),
    (created) => `${created.code}: ${parsed.intent} ${propertyType}`,
    channel,
    attribution,
  );
}

export async function submitOwnerEnquiry(db: SqlDb, value: unknown, options: EnquiryOptions): Promise<EnquiryResult> {
  const body = asRecord(value);
  const channel = conversionOf(body.conversionChannel);
  const attribution = await attributionOf(body, options.now, options.attributionCookie ?? null, options.attributionSecret ?? null);
  const timeline = TIMELINES.find((item) => item === body.timeline) ?? "Exploring";
  const extra = text(body.notes, 4000);
  const parsed = parseOwnerLeadInput({
    intent: body.intent,
    propertyType: body.propertyType,
    locality: body.locality,
    locationText: body.locationText,
    expectedPrice: body.expectedPrice,
    notes: [`Availability: ${timeline}`, extra].filter(Boolean).join("\n\n"),
    priority: ownerPriority(timeline),
  });
  const contact = { name: nameOf(body.name), phone: phoneFromParts(body.countryCode, body.mobile), email: emailOf(body.email) };
  return guarded(
    db,
    "owner",
    body,
    options,
    (planned, alongside) =>
      createOwnerLead(db, WEBSITE_ACTOR, contact, parsed, sourceFor(channel, attribution.last, options.now), options.now, {
        id: planned.id,
        code: planned.code,
        alongside,
      }),
    (created) => `${created.code}: ${parsed.intent} ${parsed.propertyType || "property"}`,
    channel,
    attribution,
  );
}

export async function submitLandJvEnquiry(db: SqlDb, value: unknown, options: EnquiryOptions): Promise<EnquiryResult> {
  const body = asRecord(value);
  const channel = conversionOf(body.conversionChannel);
  const attribution = await attributionOf(body, options.now, options.attributionCookie ?? null, options.attributionSecret ?? null);
  const village = text(body.village, 160);
  const taluk = text(body.taluk, 80);
  const extent = text(body.extent, 40);
  const unit = text(body.unit, 40);
  if (village.length < 2) throw new HttpError(400, "Enter the village name.");
  if (taluk.length < 2) throw new HttpError(400, "Enter the taluk or area.");
  const answers: LandJvAnswer[] = [
    ["village", "Village", village],
    ["taluk", "Taluk", taluk],
    ["district", "District", text(body.district, 80)],
    ["extent", "Land extent", [extent, unit].filter(Boolean).join(" ")],
    ["ownership", "Ownership", text(body.ownership, 80)],
    ["rtc", "RTC / Pahani", text(body.rtc, 40)],
    ["road", "Road access", text(body.road, 40)],
    ["co_owners", "Co-owners agree", text(body.coOwners, 40)],
    ["partnership", "Development partnership", text(body.partnership, 40)],
    ["notes", "Notes", text(body.notes, 800)],
  ].map(([key, label, value]) => ({ key, label, value }));
  const contact = { name: nameOf(body.name), phone: phoneFromParts(body.countryCode, body.mobile), email: emailOf(body.email) };
  return guarded(
    db,
    "land_jv",
    body,
    options,
    (planned, alongside) =>
      createLandJvEnquiry(
        db,
        WEBSITE_ACTOR,
        contact,
        {
          taluk,
          village,
          acreBand: [extent, unit].filter(Boolean).join(" ").slice(0, 80),
          ownership: text(body.ownership, 80),
          rtcAvailable: text(body.rtc, 40),
          roadAccess: text(body.road, 40),
          ownersAgree: text(body.coOwners, 40),
          answers,
          notes: text(body.notes, 800),
        },
        sourceFor(channel, attribution.last, options.now),
        options.now,
        { id: planned.id, code: planned.code, alongside },
      ),
    (created) => `${created.code}: Agricultural land JV`,
    channel,
    attribution,
  );
}
