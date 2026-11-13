import type { ContactSource } from "@/lib/analytics/types";
import { FURNISHING_PREFERENCES, TENANT_PROFILES } from "@/lib/crm/options";
import { questionKeys, preferencePayloadKeys, questionsFor, type QuestionKey } from "@/lib/enquiry/questions";
import { whatsAppHref } from "@/lib/services";
import { site } from "@/lib/site";
import type { PropertyType } from "@/lib/types";

export const UNVERIFIED_ATTRIBUTION_NOTICE =
  "First visit not confirmed. This enquiry keeps going, and its first-touch attribution stays unverified.";

export const BUYER_TYPES: PropertyType[] = ["House", "Flat", "Villa", "Plot", "Commercial", "PG"];
export const TIMELINE_OPTIONS = ["Immediate", "Within 7 days", "Within 30 days", "Within 3 months", "Exploring"] as const;
export const FURNISHING_OPTIONS = FURNISHING_PREFERENCES;
export const TENANT_OPTIONS = TENANT_PROFILES;

export type WizardPath = "buyer" | "owner";

export type EnquiryLaunch = {
  cta: ContactSource;
  path?: WizardPath;
  intent?: "Buy" | "Rent";
  propertyType?: PropertyType;
  locality?: string;
  bhk?: number | null;
  propertySlug?: string;
  propertyTitle?: string;
  listing?: "Rent" | "Sale";
  page?: string;
};

export type WizardDraft = {
  path: WizardPath | "";
  intent: "Buy" | "Rent" | "";
  ownerIntent: "Rent" | "Sale" | "Lease" | "";
  propertyType: PropertyType | "";
  bhkMin: string;
  bhkMax: string;
  localities: string[];
  flexibleLocality: boolean;
  otherLocality: string;
  budgetMin: string;
  budgetMax: string;
  timeline: (typeof TIMELINE_OPTIONS)[number] | "";
  furnishing: (typeof FURNISHING_OPTIONS)[number];
  tenantProfile: (typeof TENANT_OPTIONS)[number];
  parking: "" | "Yes" | "No";
  area: string;
  intendedUse: string;
  plotArea: string;
  roadAccess: string;
  leaseDuration: string;
  approvalPreference: string;
  commercialUse: string;
  floorPreference: string;
  occupantType: string;
  sharing: string;
  facilities: string[];
  locationText: string;
  notes: string;
  name: string;
  countryCode: string;
  mobile: string;
  email: string;
  privacyAccepted: boolean;
  marketingConsent: boolean;
  company: string;
};

export function emptyDraft(): WizardDraft {
  return {
    path: "",
    intent: "",
    ownerIntent: "",
    propertyType: "",
    bhkMin: "",
    bhkMax: "",
    localities: [],
    flexibleLocality: false,
    otherLocality: "",
    budgetMin: "",
    budgetMax: "",
    timeline: "",
    furnishing: "Any",
    tenantProfile: "Any",
    parking: "",
    area: "",
    intendedUse: "",
    plotArea: "",
    roadAccess: "",
    leaseDuration: "",
    approvalPreference: "",
    commercialUse: "",
    floorPreference: "",
    occupantType: "",
    sharing: "",
    facilities: [],
    locationText: "",
    notes: "",
    name: "",
    countryCode: "91",
    mobile: "",
    email: "",
    privacyAccepted: false,
    marketingConsent: false,
    company: "",
  };
}

export function draftFromLaunch(launch: EnquiryLaunch): WizardDraft {
  const draft = emptyDraft();
  draft.path = launch.path ?? (launch.propertySlug ? "buyer" : "");
  if (launch.listing === "Rent") draft.intent = "Rent";
  if (launch.listing === "Sale") draft.intent = "Buy";
  if (launch.intent) draft.intent = launch.intent;
  draft.propertyType = launch.propertyType ?? "";
  if (launch.locality) draft.localities = [launch.locality];
  if (launch.bhk) draft.bhkMin = String(launch.bhk);
  return selectRequirement(draft, {});
}

export function bhkApplies(type: PropertyType | ""): boolean {
  return type === "House" || type === "Flat" || type === "Villa";
}

const PREFERENCE_FIELDS: Partial<Record<QuestionKey, (draft: WizardDraft) => void>> = {
  bhk: (draft) => {
    draft.bhkMin = "";
    draft.bhkMax = "";
  },
  furnishing: (draft) => {
    draft.furnishing = "Any";
  },
  tenantProfile: (draft) => {
    draft.tenantProfile = "Any";
  },
  parking: (draft) => {
    draft.parking = "";
  },
  areaMin: (draft) => {
    draft.area = "";
  },
  intendedUse: (draft) => {
    draft.intendedUse = "";
  },
  plotArea: (draft) => {
    draft.plotArea = "";
  },
  roadAccess: (draft) => {
    draft.roadAccess = "";
  },
  leaseDuration: (draft) => {
    draft.leaseDuration = "";
  },
  approvalPreference: (draft) => {
    draft.approvalPreference = "";
  },
  commercialUse: (draft) => {
    draft.commercialUse = "";
  },
  floorPreference: (draft) => {
    draft.floorPreference = "";
  },
  occupantType: (draft) => {
    draft.occupantType = "";
  },
  sharing: (draft) => {
    draft.sharing = "";
  },
  facilities: (draft) => {
    draft.facilities = [];
  },
  notes: (draft) => {
    draft.notes = "";
  },
};

/** Keeps answers that still apply and clears the ones the new selection does not ask. */
export function selectRequirement(
  draft: WizardDraft,
  patch: Partial<Pick<WizardDraft, "intent" | "propertyType">>,
): WizardDraft {
  const next: WizardDraft = {
    ...draft,
    ...patch,
    localities: [...draft.localities],
    facilities: [...draft.facilities],
  };
  const allowed = questionKeys(next.intent, next.propertyType);
  for (const [key, clear] of Object.entries(PREFERENCE_FIELDS) as [QuestionKey, (draft: WizardDraft) => void][]) {
    if (!allowed.has(key)) clear(next);
  }
  return next;
}

export type WizardStep = "path" | "need" | "place" | "budget" | "preferences" | "contact" | "success";

export function stepsFor(draft: WizardDraft): WizardStep[] {
  if (draft.path === "owner") return ["path", "need", "place", "budget", "contact", "success"];
  return ["path", "need", "place", "budget", "preferences", "contact", "success"];
}

function money(value: string): number | null {
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) return null;
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function phone(draft: WizardDraft): string {
  const code = draft.countryCode.replace(/[^\d]/g, "");
  const mobile = draft.mobile.replace(/[^\d]/g, "").replace(/^0+/, "");
  return code && mobile ? `+${code}${mobile}` : "";
}

function ownerLocality(draft: WizardDraft): string {
  return draft.localities[0] || draft.otherLocality.trim();
}

export function stepError(draft: WizardDraft, step: WizardStep): string | null {
  if (step === "path" && draft.path !== "buyer" && draft.path !== "owner") return "Choose how we can help.";
  if (step === "need") {
    if (!draft.propertyType) return "Choose a property type.";
    if (draft.path === "buyer" && !draft.intent) return "Choose buy or rent.";
    if (draft.path === "owner" && !draft.ownerIntent) return "Choose rent, sale, or lease.";
  }
  if (step === "place") {
    if (draft.path === "buyer") {
      const places = [...draft.localities, draft.otherLocality.trim()].filter(Boolean);
      if (places.length === 0) return "Choose at least one locality in Gulbarga (Kalaburagi).";
    }
    if (draft.path === "owner" && !ownerLocality(draft)) return "Enter the locality.";
  }
  if (step === "budget" && !draft.timeline) return "Choose a timeline.";
  if (step === "success") return null;
  if (step === "contact") {
    if (draft.name.trim().length < 2) return "Enter your name.";
    const dial = phone(draft);
    if (!/^\+[1-9]\d{7,14}$/.test(dial)) return "Enter a country code and mobile number.";
    if (draft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return "Enter a valid email, or leave it blank.";
    if (!draft.privacyAccepted) return "Please acknowledge how this enquiry is used.";
  }
  return null;
}

function attribution(launch: EnquiryLaunch) {
  return {
    enquiryPage: launch.page ?? "",
    cta: launch.cta,
    propertySlug: launch.propertySlug ?? "",
    propertyTitle: launch.propertyTitle ?? "",
    listingIntent: launch.listing === "Sale" ? "Buy" : launch.listing === "Rent" ? "Rent" : "",
    listingLocality: launch.locality ?? "",
  };
}

function preferenceValue(draft: WizardDraft, key: string): unknown {
  if (key === "bhkMin") return money(draft.bhkMin);
  if (key === "bhkMax") return money(draft.bhkMax);
  if (key === "furnishing") return draft.furnishing === "Any" ? undefined : draft.furnishing;
  if (key === "tenantProfile") return draft.tenantProfile === "Any" ? undefined : draft.tenantProfile;
  if (key === "parking") return draft.parking || undefined;
  if (key === "areaMin") return money(draft.area);
  if (key === "intendedUse") return draft.intendedUse;
  if (key === "plotArea") return draft.plotArea.trim();
  if (key === "roadAccess") return draft.roadAccess.trim();
  if (key === "leaseDuration") return draft.leaseDuration;
  if (key === "approvalPreference") return draft.approvalPreference;
  if (key === "commercialUse") return draft.commercialUse.trim();
  if (key === "floorPreference") return draft.floorPreference;
  if (key === "occupantType") return draft.occupantType;
  if (key === "sharing") return draft.sharing;
  if (key === "facilities") return draft.facilities.length ? draft.facilities : undefined;
  if (key === "notes") return draft.notes.trim();
  return undefined;
}

/** Only the answers that belong to the current intent and property type. */
export function preferenceBody(draft: WizardDraft): Record<string, unknown> {
  if (draft.intent !== "Buy" && draft.intent !== "Rent") return {};
  if (!draft.propertyType) return {};
  const allowed = preferencePayloadKeys(draft.intent, draft.propertyType);
  const body: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = preferenceValue(draft, key);
    if (value === undefined || value === null || value === "") continue;
    body[key] = value;
  }
  return body;
}

export function budgetQuestionLabel(draft: WizardDraft): string | null {
  if ((draft.intent !== "Buy" && draft.intent !== "Rent") || !draft.propertyType) return null;
  return questionsFor(draft.intent, draft.propertyType).find((question) => question.key === "budget")?.label ?? null;
}

export function requirementPayload(draft: WizardDraft, launch: EnquiryLaunch, idempotencyKey: string, turnstileToken: string) {
  const places = [...draft.localities, draft.otherLocality.trim()].filter(Boolean);
  const preferences = preferenceBody(draft);
  const asked = questionKeys(draft.intent, draft.propertyType);
  const bhkMin = asked.has("bhk") ? money(draft.bhkMin) : null;
  const bhkMax = asked.has("bhk") ? money(draft.bhkMax) ?? bhkMin : null;
  return {
    idempotencyKey,
    turnstileToken,
    company: draft.company,
    website: "",
    name: draft.name.trim(),
    countryCode: draft.countryCode.replace(/\D/g, ""),
    mobile: draft.mobile.replace(/\D/g, "").replace(/^0+/, ""),
    email: draft.email.trim(),
    privacyAccepted: true,
    marketingConsent: draft.marketingConsent,
    conversionChannel: "website" as const,
    intent: draft.intent,
    propertyType: draft.propertyType,
    bhkMin,
    bhkMax,
    localities: places,
    localityFlexible: draft.flexibleLocality,
    budgetMin: money(draft.budgetMin),
    budgetMax: money(draft.budgetMax),
    timeline: draft.timeline,
    furnishing: asked.has("furnishing") ? draft.furnishing : "Any",
    tenantProfile: asked.has("tenantProfile") ? draft.tenantProfile : "Any",
    parkingRequired: asked.has("parking") && draft.parking === "Yes",
    areaMin: asked.has("areaMin") ? money(draft.area) : null,
    preferences,
    attribution: attribution(launch),
  };
}

export function ownerPayload(draft: WizardDraft, launch: EnquiryLaunch, idempotencyKey: string, turnstileToken: string) {
  return {
    idempotencyKey,
    turnstileToken,
    company: draft.company,
    website: "",
    name: draft.name.trim(),
    countryCode: draft.countryCode.replace(/\D/g, ""),
    mobile: draft.mobile.replace(/\D/g, "").replace(/^0+/, ""),
    email: draft.email.trim(),
    privacyAccepted: true,
    marketingConsent: draft.marketingConsent,
    conversionChannel: "website" as const,
    intent: draft.ownerIntent,
    propertyType: draft.propertyType,
    locality: ownerLocality(draft),
    locationText: draft.locationText.trim(),
    expectedPrice: money(draft.budgetMin),
    timeline: draft.timeline,
    notes: draft.notes.trim(),
    attribution: attribution(launch),
  };
}

export function whatsAppSummary(code: string, lines: string[]): string {
  return [`GulbargaHomes enquiry ${code}`, ...lines.filter(Boolean), "I am sending this message myself from the website."].join("\n");
}

export type EnquiryHandoff = {
  code: string;
  summary: string;
  opensAutomatically: false;
  links: { phoneDisplay: string; href: string }[];
};

/** The reference and the chat links. Nothing here opens WhatsApp by itself. */
export function enquiryHandoff(code: string, draft: WizardDraft): EnquiryHandoff {
  const summary = whatsAppSummary(code, summaryLines(draft));
  return {
    code,
    summary,
    opensAutomatically: false,
    links: site.contacts.map((contact, index) => ({
      phoneDisplay: contact.phoneDisplay,
      href: whatsAppHref(summary, index),
    })),
  };
}

export type SaveGate = { phase: "idle" | "saving" | "saved"; key: string };

/** A second click while saving, or after the reference exists, must not start another record. */
export function startSave(gate: SaveGate): SaveGate | null {
  if (gate.phase !== "idle") return null;
  return { phase: "saving", key: gate.key };
}

export function finishSave(gate: SaveGate, saved: boolean): SaveGate {
  if (gate.phase !== "saving") return gate;
  return { phase: saved ? "saved" : "idle", key: gate.key };
}

export function summaryLines(draft: WizardDraft): string[] {
  if (draft.path === "owner") {
    return [
      `I own a property to ${draft.ownerIntent.toLowerCase()}`,
      draft.propertyType,
      ownerLocality(draft),
      draft.timeline,
    ];
  }
  const places = [...draft.localities, draft.otherLocality.trim()].filter(Boolean);
  const preferences = preferenceBody(draft);
  const extra = [
    typeof preferences.intendedUse === "string" ? preferences.intendedUse : "",
    typeof preferences.plotArea === "string" ? `Plot area ${preferences.plotArea}` : "",
    typeof preferences.commercialUse === "string" ? preferences.commercialUse : "",
    typeof preferences.bhkMin === "number" ? `${preferences.bhkMin}${typeof preferences.bhkMax === "number" && preferences.bhkMax !== preferences.bhkMin ? `–${preferences.bhkMax}` : ""} BHK` : "",
    typeof preferences.furnishing === "string" ? preferences.furnishing : "",
    typeof preferences.tenantProfile === "string" ? preferences.tenantProfile : "",
  ].filter(Boolean);
  return [
    `I want to ${draft.intent.toLowerCase()}`,
    draft.propertyType,
    draft.flexibleLocality ? "Locality is flexible" : places.join(", "),
    draft.timeline,
    ...extra.slice(0, 3),
  ];
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
