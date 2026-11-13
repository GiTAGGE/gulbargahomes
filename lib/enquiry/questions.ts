import { HttpError } from "../admin/errors";
import { FURNISHING_PREFERENCES, TENANT_PROFILES } from "../crm/options";
import type { PropertyType } from "../types";

/**
 * Questions for a buyer or tenant requirement, chosen from intent and property
 * type. Budget stays on the budget step. Everything else is optional.
 */
export type QuestionKey =
  | "budget"
  | "intendedUse"
  | "plotArea"
  | "roadAccess"
  | "leaseDuration"
  | "approvalPreference"
  | "bhk"
  | "furnishing"
  | "tenantProfile"
  | "parking"
  | "areaMin"
  | "commercialUse"
  | "floorPreference"
  | "occupantType"
  | "sharing"
  | "facilities"
  | "notes";

export type QuestionStep = "budget" | "preferences";

export type Question = {
  key: QuestionKey;
  label: string;
  step: QuestionStep;
};

export const INTENDED_USES = ["Residential", "Commercial", "Industrial", "Other"] as const;
export const LEASE_DURATIONS = ["11 months", "1 year", "2 years", "3 years", "Flexible"] as const;
export const APPROVAL_PREFERENCES = ["Approved layout", "DC converted", "Clear title", "Other"] as const;
export const FLOOR_PREFERENCES = ["Ground floor", "First floor", "Upper floor"] as const;
export const OCCUPANT_TYPES = ["Student", "Working professional", "Family"] as const;
export const SHARING_PREFERENCES = ["Single occupancy", "Double sharing", "Triple sharing"] as const;
export const FACILITY_OPTIONS = ["Food", "Wi-Fi", "Laundry", "Attached bathroom", "AC"] as const;

export type PreferenceProfile = `${"Rent" | "Buy"}:${PropertyType}`;

export type PreferenceDetails = {
  profile?: PreferenceProfile;
  intendedUse?: (typeof INTENDED_USES)[number];
  plotArea?: string;
  roadAccess?: string;
  leaseDuration?: (typeof LEASE_DURATIONS)[number];
  approvalPreference?: (typeof APPROVAL_PREFERENCES)[number];
  commercialUse?: string;
  floorPreference?: (typeof FLOOR_PREFERENCES)[number];
  occupantType?: (typeof OCCUPANT_TYPES)[number];
  sharing?: (typeof SHARING_PREFERENCES)[number];
  facilities?: (typeof FACILITY_OPTIONS)[number][];
  parking?: "Yes" | "No";
};

const RESIDENTIAL: readonly PropertyType[] = ["House", "Flat", "Villa"];

export function profileFor(intent: "Buy" | "Rent", type: PropertyType): PreferenceProfile {
  return `${intent}:${type}`;
}

function budget(intent: "Buy" | "Rent"): Question {
  return {
    key: "budget",
    step: "budget",
    label: intent === "Rent" ? "Monthly rent budget" : "Total purchase budget",
  };
}

/** The questions that apply to this intent and property type, in display order. */
export function questionsFor(intent: "Buy" | "Rent", type: PropertyType): Question[] {
  if (type === "Plot" && intent === "Rent") {
    return [
      budget(intent),
      { key: "intendedUse", step: "preferences", label: "Intended use" },
      { key: "plotArea", step: "preferences", label: "Required plot area" },
      { key: "roadAccess", step: "preferences", label: "Preferred road width or road access" },
      { key: "leaseDuration", step: "preferences", label: "Lease duration" },
      { key: "notes", step: "preferences", label: "Additional requirements" },
    ];
  }
  if (type === "Plot") {
    return [
      budget(intent),
      { key: "intendedUse", step: "preferences", label: "Intended use" },
      { key: "plotArea", step: "preferences", label: "Required plot area" },
      { key: "roadAccess", step: "preferences", label: "Road access / road width" },
      { key: "approvalPreference", step: "preferences", label: "Approval or title preference" },
      { key: "notes", step: "preferences", label: "Additional requirements" },
    ];
  }
  if (type === "Commercial" && intent === "Rent") {
    return [
      budget(intent),
      { key: "commercialUse", step: "preferences", label: "Intended business or commercial use" },
      { key: "areaMin", step: "preferences", label: "Required area" },
      { key: "floorPreference", step: "preferences", label: "Floor preference" },
      { key: "roadAccess", step: "preferences", label: "Road access / frontage" },
      { key: "parking", step: "preferences", label: "Parking requirement" },
      { key: "leaseDuration", step: "preferences", label: "Lease duration" },
    ];
  }
  if (type === "Commercial") {
    return [
      budget(intent),
      { key: "commercialUse", step: "preferences", label: "Intended commercial use" },
      { key: "areaMin", step: "preferences", label: "Required area" },
      { key: "floorPreference", step: "preferences", label: "Floor preference" },
      { key: "roadAccess", step: "preferences", label: "Road access / frontage" },
      { key: "notes", step: "preferences", label: "Additional requirements" },
    ];
  }
  if (type === "PG") {
    return [
      budget(intent),
      { key: "occupantType", step: "preferences", label: "Occupant type" },
      { key: "sharing", step: "preferences", label: "Sharing preference" },
      { key: "furnishing", step: "preferences", label: "Furnishing preference" },
      { key: "facilities", step: "preferences", label: "Facilities required" },
      { key: "notes", step: "preferences", label: "Additional requirements" },
    ];
  }
  if (intent === "Rent" && RESIDENTIAL.includes(type)) {
    return [
      budget(intent),
      { key: "bhk", step: "preferences", label: "BHK / bedroom requirement" },
      { key: "furnishing", step: "preferences", label: "Furnishing preference" },
      { key: "tenantProfile", step: "preferences", label: "Tenant preference" },
      { key: "parking", step: "preferences", label: "Parking requirement" },
      { key: "areaMin", step: "preferences", label: "Minimum area" },
      { key: "notes", step: "preferences", label: "Additional requirements" },
    ];
  }
  return [
    budget(intent),
    { key: "bhk", step: "preferences", label: "BHK / bedroom requirement" },
    { key: "areaMin", step: "preferences", label: "Minimum area" },
    { key: "parking", step: "preferences", label: "Parking preference" },
    { key: "furnishing", step: "preferences", label: "Furnishing preference" },
    { key: "notes", step: "preferences", label: "Additional requirements" },
  ];
}

export function preferenceQuestions(intent: "Buy" | "Rent", type: PropertyType): Question[] {
  return questionsFor(intent, type).filter((question) => question.step === "preferences");
}

export function questionKeys(intent: "Buy" | "Rent" | "", type: PropertyType | ""): Set<QuestionKey> {
  if (intent !== "Buy" && intent !== "Rent") return new Set();
  if (!type) return new Set();
  return new Set(questionsFor(intent, type).map((question) => question.key));
}

/** Payload keys accepted inside `preferences` for this requirement. */
export function preferencePayloadKeys(intent: "Buy" | "Rent", type: PropertyType): Set<string> {
  const keys = new Set<string>();
  for (const question of preferenceQuestions(intent, type)) {
    if (question.key === "bhk") {
      keys.add("bhkMin");
      keys.add("bhkMax");
    } else keys.add(question.key);
  }
  return keys;
}

const KNOWN_PAYLOAD_KEYS = [
  "intendedUse",
  "plotArea",
  "roadAccess",
  "leaseDuration",
  "approvalPreference",
  "bhkMin",
  "bhkMax",
  "furnishing",
  "tenantProfile",
  "parking",
  "areaMin",
  "commercialUse",
  "floorPreference",
  "occupantType",
  "sharing",
  "facilities",
  "notes",
] as const;

export type ParsedPreferences = {
  bhkMin: number | null;
  bhkMax: number | null;
  furnishing: (typeof FURNISHING_PREFERENCES)[number];
  tenantProfile: (typeof TENANT_PROFILES)[number];
  parkingRequired: boolean;
  areaMin: number | null;
  notes: string;
  details: PreferenceDetails;
};

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Preferences are not in a recognised format.");
  }
  return value as Record<string, unknown>;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], label: string): T | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new HttpError(400, `Choose a valid ${label}.`);
  }
  return value as T;
}

function optionalBoundedText(value: unknown, max: number, label: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new HttpError(400, `${label} is not valid.`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > max) throw new HttpError(400, `${label} is too long.`);
  return trimmed;
}

function optionalCount(value: unknown, label: string, max: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) {
    throw new HttpError(400, `Enter a valid ${label}.`);
  }
  return value;
}

function facilitiesOf(value: unknown): (typeof FACILITY_OPTIONS)[number][] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new HttpError(400, "Choose valid facilities.");
  if (value.length > FACILITY_OPTIONS.length) throw new HttpError(400, "Choose valid facilities.");
  const chosen: (typeof FACILITY_OPTIONS)[number][] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(FACILITY_OPTIONS as readonly string[]).includes(item)) {
      throw new HttpError(400, "Choose valid facilities.");
    }
    const facility = item as (typeof FACILITY_OPTIONS)[number];
    if (!chosen.includes(facility)) chosen.push(facility);
  }
  return chosen.length ? chosen : undefined;
}

function digitsOnly(value: string): number | null {
  if (!/^\d{1,8}$/.test(value)) return null;
  const amount = Number(value);
  return amount > 0 ? amount : null;
}

/**
 * Accepts only the preferences that belong to this intent and property type.
 * Unknown keys and values outside the allowed lists are rejected.
 */
export function parseWebsitePreferences(intent: "Buy" | "Rent", type: PropertyType, value: unknown): ParsedPreferences {
  const body = plainObject(value);
  const allowed = preferencePayloadKeys(intent, type);
  for (const key of Object.keys(body)) {
    if (!(KNOWN_PAYLOAD_KEYS as readonly string[]).includes(key) || !allowed.has(key)) {
      throw new HttpError(400, "That preference does not apply to this requirement.");
    }
  }
  const bhkMin = optionalCount(body.bhkMin, "BHK", 10);
  const bhkMax = optionalCount(body.bhkMax, "BHK", 10);
  if (bhkMin !== null && bhkMax !== null && bhkMin > bhkMax) {
    throw new HttpError(400, "Minimum BHK is above maximum BHK.");
  }
  const furnishing = optionalEnum(body.furnishing, FURNISHING_PREFERENCES, "furnishing preference") ?? "Any";
  const tenantProfile = optionalEnum(body.tenantProfile, TENANT_PROFILES, "tenant preference") ?? "Any";
  const parking = optionalEnum(body.parking, ["Yes", "No"] as const, "parking choice");
  const areaFromQuestion = optionalCount(body.areaMin, "area", 10_000_000);
  const plotArea = optionalBoundedText(body.plotArea, 80, "Plot area");
  const details: PreferenceDetails = { profile: profileFor(intent, type) };
  const intendedUse = optionalEnum(body.intendedUse, INTENDED_USES, "intended use");
  const roadAccess = optionalBoundedText(body.roadAccess, 120, "Road access");
  const leaseDuration = optionalEnum(body.leaseDuration, LEASE_DURATIONS, "lease duration");
  const approvalPreference = optionalEnum(body.approvalPreference, APPROVAL_PREFERENCES, "approval or title preference");
  const commercialUse = optionalBoundedText(body.commercialUse, 80, "Commercial use");
  const floorPreference = optionalEnum(body.floorPreference, FLOOR_PREFERENCES, "floor preference");
  const occupantType = optionalEnum(body.occupantType, OCCUPANT_TYPES, "occupant type");
  const sharing = optionalEnum(body.sharing, SHARING_PREFERENCES, "sharing preference");
  const facilities = facilitiesOf(body.facilities);
  const notes = optionalBoundedText(body.notes, 800, "Additional requirements") ?? "";
  if (intendedUse) details.intendedUse = intendedUse;
  if (plotArea) details.plotArea = plotArea;
  if (roadAccess) details.roadAccess = roadAccess;
  if (leaseDuration) details.leaseDuration = leaseDuration;
  if (approvalPreference) details.approvalPreference = approvalPreference;
  if (commercialUse) details.commercialUse = commercialUse;
  if (floorPreference) details.floorPreference = floorPreference;
  if (occupantType) details.occupantType = occupantType;
  if (sharing) details.sharing = sharing;
  if (facilities) details.facilities = facilities;
  if (parking) details.parking = parking;
  if (furnishing !== "Any") {
    // Kept on the furnishing column. The profile says it was asked.
  }
  return {
    bhkMin,
    bhkMax: bhkMax ?? bhkMin,
    furnishing,
    tenantProfile,
    parkingRequired: parking === "Yes",
    areaMin: areaFromQuestion ?? (plotArea ? digitsOnly(plotArea) : null),
    notes,
    details,
  };
}

const PROFILE_PATTERN = /^(Rent|Buy):(House|Flat|Villa|Plot|Commercial|PG)$/;

function enumMember<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Drops unknown or invalid stored preference keys so older rows stay readable. */
export function readPreferenceDetails(value: unknown): PreferenceDetails {
  let parsed: unknown = value;
  if (typeof value === "string") {
    if (!value.trim()) return {};
    try {
      parsed = JSON.parse(value);
    } catch {
      return {};
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const body = parsed as Record<string, unknown>;
  const details: PreferenceDetails = {};
  if (typeof body.profile === "string" && PROFILE_PATTERN.test(body.profile)) {
    details.profile = body.profile as PreferenceProfile;
  }
  const intendedUse = enumMember(body.intendedUse, INTENDED_USES);
  const leaseDuration = enumMember(body.leaseDuration, LEASE_DURATIONS);
  const approvalPreference = enumMember(body.approvalPreference, APPROVAL_PREFERENCES);
  const floorPreference = enumMember(body.floorPreference, FLOOR_PREFERENCES);
  const occupantType = enumMember(body.occupantType, OCCUPANT_TYPES);
  const sharing = enumMember(body.sharing, SHARING_PREFERENCES);
  const parking = enumMember(body.parking, ["Yes", "No"] as const);
  if (intendedUse) details.intendedUse = intendedUse;
  if (typeof body.plotArea === "string" && body.plotArea.trim()) details.plotArea = body.plotArea.trim().slice(0, 80);
  if (typeof body.roadAccess === "string" && body.roadAccess.trim()) details.roadAccess = body.roadAccess.trim().slice(0, 120);
  if (leaseDuration) details.leaseDuration = leaseDuration;
  if (approvalPreference) details.approvalPreference = approvalPreference;
  if (typeof body.commercialUse === "string" && body.commercialUse.trim()) details.commercialUse = body.commercialUse.trim().slice(0, 80);
  if (floorPreference) details.floorPreference = floorPreference;
  if (occupantType) details.occupantType = occupantType;
  if (sharing) details.sharing = sharing;
  if (parking) details.parking = parking;
  if (Array.isArray(body.facilities)) {
    const facilities = body.facilities.filter((item): item is (typeof FACILITY_OPTIONS)[number] =>
      typeof item === "string" && (FACILITY_OPTIONS as readonly string[]).includes(item),
    );
    if (facilities.length) details.facilities = Array.from(new Set(facilities));
  }
  return details;
}

export type PreferenceLine = { label: string; value: string };

type PreferenceView = {
  preferenceDetails: PreferenceDetails;
  bhkMin: number | null;
  bhkMax: number | null;
  furnishing: string;
  tenantProfile: string;
  parkingRequired: boolean;
  areaMin: number | null;
};

function bhkLabel(min: number | null, max: number | null): string {
  if (min === null && max === null) return "";
  if (max === null || min === max) return `${max ?? min} BHK`;
  if (min === null) return `${max} BHK`;
  return `${min}–${max} BHK`;
}

/** Labels and answers for the CRM card. Empty optional answers are left out. */
export function preferenceLines(requirement: PreferenceView): PreferenceLine[] {
  const profile = requirement.preferenceDetails.profile;
  if (!profile || !PROFILE_PATTERN.test(profile)) return [];
  const [intent, type] = profile.split(":") as ["Buy" | "Rent", PropertyType];
  const details = requirement.preferenceDetails;
  const lines: PreferenceLine[] = [];
  for (const question of preferenceQuestions(intent, type)) {
    let value = "";
    if (question.key === "intendedUse") value = details.intendedUse ?? "";
    if (question.key === "plotArea") value = details.plotArea ?? "";
    if (question.key === "roadAccess") value = details.roadAccess ?? "";
    if (question.key === "leaseDuration") value = details.leaseDuration ?? "";
    if (question.key === "approvalPreference") value = details.approvalPreference ?? "";
    if (question.key === "commercialUse") value = details.commercialUse ?? "";
    if (question.key === "floorPreference") value = details.floorPreference ?? "";
    if (question.key === "occupantType") value = details.occupantType ?? "";
    if (question.key === "sharing") value = details.sharing ?? "";
    if (question.key === "facilities") value = details.facilities?.join(", ") ?? "";
    if (question.key === "bhk") value = bhkLabel(requirement.bhkMin, requirement.bhkMax);
    if (question.key === "furnishing" && requirement.furnishing !== "Any") value = requirement.furnishing;
    if (question.key === "tenantProfile" && requirement.tenantProfile !== "Any") value = requirement.tenantProfile;
    if (question.key === "parking") {
      value = details.parking === "Yes" || requirement.parkingRequired ? "Needed" : details.parking === "No" ? "Not needed" : "";
    }
    if (question.key === "areaMin" && requirement.areaMin) value = `${requirement.areaMin} sq ft`;
    if (value) lines.push({ label: question.label, value });
  }
  return lines;
}
