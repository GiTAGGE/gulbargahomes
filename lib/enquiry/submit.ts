import { auditStatement, type AuditActor } from "../admin/audit";
import { HttpError, isUniqueViolation } from "../admin/errors";
import { newId, type SqlDb } from "../db/sql";
import { text } from "../crm/input";
import { createLandJvEnquiry, type LandJvAnswer } from "../crm/land-jv";
import { createOwnerLead, parseOwnerLeadInput } from "../crm/owner-leads";
import { normalizeContactPhone, normalizeIndianMobile } from "../crm/phone";
import { createRequirement, parseRequirementInput } from "../crm/requirements";
import type { SourceInput } from "../crm/sources";
import { PROPERTY_TYPES, TIMELINES, type Priority, type Timeline } from "../crm/options";
import { classifyTouch, readTouch, type ClassifiedTouch } from "./attribution";
import { rememberVisit } from "./capture";

export const WEBSITE_ACTOR: AuditActor = { id: "website_enquiry", email: "website-enquiry", role: "system" };

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT = 8;

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
};

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

function attributionOf(body: Record<string, unknown>, now: string) {
  const raw = asRecord(body.attribution ?? {});
  const memory = rememberVisit({ first: readTouch(raw.first), last: readTouch(raw.first) }, readTouch(raw.last), now);
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

async function completed(db: SqlDb, key: string, kind: EnquiryKind): Promise<EnquiryResult | null> {
  if (!KEY_PATTERN.test(key)) throw new HttpError(400, "Send a submission key.");
  const existing = await db
    .prepare("SELECT kind, entity_type, entity_id, entity_code FROM public_enquiry_keys WHERE idempotency_key = ?1")
    .bind(key)
    .first<{ kind: string; entity_type: string; entity_id: string; entity_code: string }>();
  if (existing?.entity_id) {
    if (existing.kind !== kind) throw new HttpError(409, "That submission key was already used.");
    const stored = await db
      .prepare("SELECT conversion_channel FROM acquisition_attributions WHERE entity_type = ?1 AND entity_id = ?2")
      .bind(existing.entity_type, existing.entity_id)
      .first<{ conversion_channel: string }>();
    const channel = stored?.conversion_channel === "whatsapp" ? "whatsapp" : "website";
    return {
      ok: true,
      kind,
      id: existing.entity_id,
      code: existing.entity_code,
      conversionChannel: channel,
      summary: existing.entity_code,
      replayed: true,
    };
  }
  if (existing) throw new HttpError(409, "This enquiry is already being submitted.");
  return null;
}

async function reserve(db: SqlDb, key: string, kind: EnquiryKind, now: string): Promise<EnquiryResult | null> {
  const done = await completed(db, key, kind);
  if (done) return done;
  try {
    await db
      .prepare(
        `INSERT INTO public_enquiry_keys (id, idempotency_key, kind, entity_type, entity_id, entity_code, created_at)
         VALUES (?1, ?2, ?3, '', '', '', ?4)`,
      )
      .bind(newId("pek"), key, kind, now)
      .run();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return reserve(db, key, kind, now);
  }
  return null;
}

async function finishKey(db: SqlDb, key: string, entityType: string, id: string, code: string) {
  await db
    .prepare("UPDATE public_enquiry_keys SET entity_type = ?2, entity_id = ?3, entity_code = ?4 WHERE idempotency_key = ?1")
    .bind(key, entityType, id, code)
    .run();
}

async function releaseKey(db: SqlDb, key: string) {
  await db.prepare("DELETE FROM public_enquiry_keys WHERE idempotency_key = ?1 AND entity_id = ''").bind(key).run();
}

async function storeAttribution(
  db: SqlDb,
  entityType: string,
  entityId: string,
  attribution: ReturnType<typeof attributionOf>,
  channel: "website" | "whatsapp",
  marketingConsent: boolean,
  now: string,
) {
  const first = attribution.first;
  const last = attribution.last;
  await db.batch([
    db
      .prepare(
        `INSERT INTO acquisition_attributions (
           id, entity_type, entity_id,
           first_source, first_medium, first_campaign, first_campaign_id, first_term, first_content, first_landing_page, first_referrer, first_referrer_domain, first_seen_at,
           last_source, last_medium, last_campaign, last_campaign_id, last_term, last_content, last_landing_page, last_referrer, last_referrer_domain, last_seen_at,
           referrer_domain, enquiry_page, conversion_channel, cta_placement, property_slug, property_title, listing_intent, listing_locality,
           gclid, gbraid, wbraid, fbclid, fbp, fbc, marketing_consent, created_at
         ) VALUES (${Array.from({ length: 39 }, (_, index) => `?${index + 1}`).join(", ")})`,
      )
      .bind(
        newId("acq"),
        entityType,
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
        last.gclid,
        last.gbraid,
        last.wbraid,
        last.fbclid,
        last.fbp,
        last.fbc,
        marketingConsent ? 1 : 0,
        now,
      ),
    auditStatement(db, {
      actor: WEBSITE_ACTOR,
      entityType: entityType === "requirement" ? "requirement" : entityType === "owner_lead" ? "owner_lead" : "land_jv_enquiry",
      entityId,
      action: "attribute",
      context: { first_source: first.source, last_source: last.source, conversion_channel: channel },
      at: now,
    }),
  ]);
}

function guard(body: Record<string, unknown>, options: EnquiryOptions) {
  if (text(body.company, 200) || text(body.website, 200)) throw new HttpError(400, "This enquiry could not be submitted.");
  privacyOf(body.privacyAccepted);
  if (!options.humanVerified) throw new HttpError(403, "The enquiry check failed. Please try again.");
  if (!options.ipHash) throw new HttpError(400, "The enquiry could not be submitted.");
}

async function guarded<T extends { id: string; code: string }>(
  db: SqlDb,
  kind: EnquiryKind,
  body: Record<string, unknown>,
  options: EnquiryOptions,
  create: () => Promise<T>,
  entityType: string,
  summary: (created: T) => string,
  channel: "website" | "whatsapp",
  attribution: ReturnType<typeof attributionOf>,
): Promise<EnquiryResult> {
  guard(body, options);
  const replay = await completed(db, options.idempotencyKey, kind);
  if (replay) return replay;
  await assertRate(db, options.ipHash, options.now, options.rateLimit ?? RATE_LIMIT);
  const reserved = await reserve(db, options.idempotencyKey, kind, options.now);
  if (reserved) return reserved;
  try {
    const created = await create();
    await storeAttribution(db, entityType, created.id, attribution, channel, body.marketingConsent === true, options.now);
    await finishKey(db, options.idempotencyKey, entityType, created.id, created.code);
    console.info("website enquiry stored", { kind, code: created.code, source: attribution.last.source, channel });
    return { ok: true, kind, id: created.id, code: created.code, conversionChannel: channel, summary: summary(created), replayed: false };
  } catch (error) {
    await releaseKey(db, options.idempotencyKey);
    console.error("website enquiry failed", { kind, message: error instanceof Error ? error.message : "failed" });
    throw error;
  }
}

export async function submitRequirementEnquiry(db: SqlDb, value: unknown, options: EnquiryOptions): Promise<EnquiryResult> {
  const body = asRecord(value);
  const channel = conversionOf(body.conversionChannel);
  const attribution = attributionOf(body, options.now);
  const propertyType = PROPERTY_TYPES.find((type) => type === body.propertyType);
  if (!propertyType) throw new HttpError(400, "Choose a property type.");
  const bhkRelevant = propertyType !== "Plot" && propertyType !== "Commercial";
  const parsed = parseRequirementInput({
    intent: body.intent,
    propertyTypes: [propertyType],
    bhkMin: bhkRelevant ? body.bhkMin : null,
    bhkMax: bhkRelevant ? body.bhkMax : null,
    budgetMin: body.budgetMin,
    budgetMax: body.budgetMax,
    localities: body.localities,
    localityFlexible: body.localityFlexible === true,
    areaMin: body.areaMin,
    furnishing: body.furnishing,
    tenantProfile: body.tenantProfile,
    parkingRequired: body.parkingRequired === true,
    timeline: body.timeline,
    notes: "",
  });
  if (!parsed.localities.length) throw new HttpError(400, "Add at least one locality.");
  const contact = { name: nameOf(body.name), phone: phoneFromParts(body.countryCode, body.mobile), email: emailOf(body.email) };
  return guarded(
    db,
    "requirement",
    body,
    options,
    () => createRequirement(db, WEBSITE_ACTOR, contact, parsed, sourceFor(channel, attribution.last, options.now), options.now),
    "requirement",
    (created) => `${created.code}: ${parsed.intent} ${propertyType}`,
    channel,
    attribution,
  );
}

export async function submitOwnerEnquiry(db: SqlDb, value: unknown, options: EnquiryOptions): Promise<EnquiryResult> {
  const body = asRecord(value);
  const channel = conversionOf(body.conversionChannel);
  const attribution = attributionOf(body, options.now);
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
    () => createOwnerLead(db, WEBSITE_ACTOR, contact, parsed, sourceFor(channel, attribution.last, options.now), options.now),
    "owner_lead",
    (created) => `${created.code}: ${parsed.intent} ${parsed.propertyType || "property"}`,
    channel,
    attribution,
  );
}

export async function submitLandJvEnquiry(db: SqlDb, value: unknown, options: EnquiryOptions): Promise<EnquiryResult> {
  const body = asRecord(value);
  const channel = conversionOf(body.conversionChannel);
  const attribution = attributionOf(body, options.now);
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
    () =>
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
      ),
    "land_jv_enquiry",
    (created) => `${created.code}: Agricultural land JV`,
    channel,
    attribution,
  );
}
