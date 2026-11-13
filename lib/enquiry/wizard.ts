import type { ContactSource } from "@/lib/analytics/types";
import { whatsAppHref } from "@/lib/services";
import { site } from "@/lib/site";
import type { PropertyType } from "@/lib/types";

export const UNVERIFIED_ATTRIBUTION_NOTICE =
  "First visit not confirmed. This enquiry keeps going, and its first-touch attribution stays unverified.";

export const BUYER_TYPES: PropertyType[] = ["House", "Flat", "Villa", "Plot", "Commercial", "PG"];
export const TIMELINE_OPTIONS = ["Immediate", "Within 7 days", "Within 30 days", "Within 3 months", "Exploring"] as const;
export const FURNISHING_OPTIONS = ["Any", "Fully Furnished", "Semi Furnished", "Unfurnished"] as const;
export const TENANT_OPTIONS = ["Any", "Family", "Bachelors", "Students", "Working professionals", "Company lease"] as const;

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
  return draft;
}

export function bhkApplies(type: PropertyType | ""): boolean {
  return type !== "" && type !== "Plot" && type !== "Commercial";
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

export function requirementPayload(draft: WizardDraft, launch: EnquiryLaunch, idempotencyKey: string, turnstileToken: string) {
  const places = [...draft.localities, draft.otherLocality.trim()].filter(Boolean);
  const bhkMin = bhkApplies(draft.propertyType) ? money(draft.bhkMin) : null;
  const bhkMax = bhkApplies(draft.propertyType) ? money(draft.bhkMax) ?? bhkMin : null;
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
    furnishing: draft.furnishing,
    tenantProfile: draft.intent === "Rent" ? draft.tenantProfile : "Any",
    parkingRequired: draft.parking === "Yes",
    areaMin: money(draft.area),
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
  return [
    `I want to ${draft.intent.toLowerCase()}`,
    draft.propertyType,
    draft.flexibleLocality ? "Locality is flexible" : places.join(", "),
    draft.timeline,
  ];
}

export function newIdempotencyKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
