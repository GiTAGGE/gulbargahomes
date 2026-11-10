import type { PropertyType } from "../types";

export const LEAD_CHANNELS = [
  "meta_lead_form",
  "website",
  "whatsapp",
  "phone",
  "walk_in",
  "referral",
  "manual",
  "csv_import",
] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const LEAD_CHANNEL_LABEL: Record<LeadChannel, string> = {
  meta_lead_form: "Meta lead form",
  website: "Website",
  whatsapp: "WhatsApp",
  phone: "Phone call",
  walk_in: "Walk-in",
  referral: "Referral",
  manual: "Manual entry",
  csv_import: "CSV import",
};

export const META_PLATFORMS = ["", "facebook", "instagram"] as const;

export const OWNER_INTENTS = ["Rent", "Sale"] as const;
export type OwnerIntent = (typeof OWNER_INTENTS)[number];

export const OWNER_LEAD_STATUSES = [
  "New",
  "Contacted",
  "Details pending",
  "Converted",
  "Not interested",
  "Unreachable",
  "Duplicate",
  "Invalid",
] as const;
export type OwnerLeadStatus = (typeof OWNER_LEAD_STATUSES)[number];
export const OWNER_LEAD_OPEN: readonly OwnerLeadStatus[] = ["New", "Contacted", "Details pending"];

export const PRIORITIES = ["Hot", "Warm", "Cold"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const DEMAND_INTENTS = ["Rent", "Buy"] as const;
export type DemandIntent = (typeof DEMAND_INTENTS)[number];

export const REQUIREMENT_STATUSES = [
  "New",
  "Contacted",
  "Verified",
  "Qualified",
  "Matched",
  "Property shared",
  "Visit scheduled",
  "Visited",
  "Negotiation",
  "Converted",
  "Lost",
  "Postponed",
  "Duplicate",
  "Invalid",
] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export const REQUIREMENT_CLOSED: readonly RequirementStatus[] = ["Converted", "Lost", "Duplicate", "Invalid"];

export const TIMELINES = [
  "Immediate",
  "Within 7 days",
  "Within 30 days",
  "Within 3 months",
  "Exploring",
] as const;
export type Timeline = (typeof TIMELINES)[number];
export const URGENT_TIMELINES: readonly Timeline[] = ["Immediate", "Within 7 days"];

export const TENANT_PROFILES = ["Any", "Family", "Bachelors", "Students", "Working professionals", "Company lease"] as const;
export const FURNISHING_PREFERENCES = ["Any", "Fully Furnished", "Semi Furnished", "Unfurnished"] as const;
export const VEGETARIAN_PREFERENCES = ["Any", "Yes", "Preferred"] as const;

export const PROPERTY_TYPES: PropertyType[] = ["House", "Flat", "Villa", "Plot", "Commercial", "PG"];

export const ACTIVITY_KINDS = ["call", "whatsapp", "sms", "email", "note", "visit", "owner_confirmation"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  call: "Call",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  note: "Note",
  visit: "Site visit",
  owner_confirmation: "Owner confirmation",
};

export const ACTIVITY_OUTCOMES = [
  "",
  "connected",
  "no_answer",
  "busy",
  "switched_off",
  "wrong_number",
  "callback_requested",
  "sent",
  "replied",
] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

export const ACTIVITY_OUTCOME_LABEL: Record<ActivityOutcome, string> = {
  "": "—",
  connected: "Connected",
  no_answer: "No answer",
  busy: "Busy",
  switched_off: "Switched off",
  wrong_number: "Wrong number",
  callback_requested: "Asked for a callback",
  sent: "Sent",
  replied: "Replied",
};

/** Outcomes that count as having reached the person. */
export const CONTACTED_OUTCOMES: readonly ActivityOutcome[] = ["connected", "callback_requested", "replied"];

export const ACTIVITY_CHANNELS = ["manual", "wa_business_app", "wa_cloud_api"] as const;
export type ActivityChannel = (typeof ACTIVITY_CHANNELS)[number];

export const CRM_ENTITY_TYPES = ["owner_lead", "requirement", "property", "contact"] as const;
export type CrmEntityType = (typeof CRM_ENTITY_TYPES)[number];

export const FOLLOWUP_PRIORITIES = ["High", "Normal", "Low"] as const;

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function strictOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
