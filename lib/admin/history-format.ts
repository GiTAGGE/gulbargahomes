import type { FieldChanges } from "./audit";
import { formatDateTime } from "./format";
import { preferenceLines, readPreferenceDetails } from "../enquiry/questions";

const FIELD_LABEL: Record<string, string> = {
  status: "Status",
  role_review: "Classification",
  role_review_note: "Classification note",
  quality_review: "Verification",
  quality_review_note: "Verification note",
  verification_status: "Verification",
  publication_status: "Publication",
  price: "Price",
  price_suffix: "Price suffix",
  discreet_matching: "Discreet",
  availability_verified_at: "Availability checked",
  availability_valid_days: "Valid for (days)",
  rejection_reason: "Reason",
  intent: "Intent",
  property_types_json: "Property type",
  bhk_min: "Minimum BHK",
  bhk_max: "Maximum BHK",
  budget_min: "Minimum budget",
  budget_max: "Maximum budget",
  localities_json: "Locality",
  locality_flexible: "Nearby localities",
  area_min: "Minimum area",
  furnishing: "Furnishing",
  tenant_profile: "Tenant profile",
  vegetarian: "Vegetarian",
  parking_required: "Parking",
  timeline: "How soon",
  needed_by: "Needed by",
  confirmed_timeline: "Confirmed timeline",
  confirmed_needed_by: "Confirmed deadline",
  notes: "Additional requirements",
  preference_details_json: "Preferences",
};

export type HistoryLine = { key: string; label: string; text: string };

function labelFor(field: string): string {
  return FIELD_LABEL[field] ?? field.replace(/_/g, " ");
}

function parsed(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function show(value: unknown, field?: string): string {
  if ((field === "role_review" || field === "quality_review") && (value === "" || value === null || value === undefined)) {
    return "pending";
  }
  if (field === "role_review" || field === "quality_review") {
    if (value === "genuine") return "genuine";
    if (value === "misclassified") return "not an owner";
    if (value === "unqualified") return "not a genuine enquiry";
  }
  if (field === "parking_required") return value === 1 || value === true ? "Required" : "Not needed";
  if (field === "locality_flexible") return value === 1 || value === true ? "Nearby OK" : "No";
  const readable = parsed(value);
  if (typeof readable === "string" && /^\d{4}-\d{2}-\d{2}T/.test(readable)) return formatDateTime(readable);
  if (readable === null || readable === undefined || readable === "") return "—";
  if (Array.isArray(readable)) return readable.length ? readable.join(", ") : "—";
  if (typeof readable === "object") return JSON.stringify(readable);
  return String(readable);
}

function preferenceHistory(value: unknown, notes: unknown): { label: string; value: string }[] {
  const details = readPreferenceDetails(value);
  if (!details.profile) return [];
  return preferenceLines({
    preferenceDetails: details,
    bhkMin: null,
    bhkMax: null,
    furnishing: "Any",
    tenantProfile: "Any",
    parkingRequired: false,
    areaMin: null,
    notes: typeof notes === "string" ? notes : "",
  });
}

/** Every changed field, with property preferences written out instead of hidden. */
export function formatHistoryChanges(changes: FieldChanges): HistoryLine[] {
  const notes = changes.notes?.[1];
  const lines: HistoryLine[] = [];
  const preferences = preferenceHistory(changes.preference_details_json?.[1], notes);
  const previousPreferences = preferenceHistory(changes.preference_details_json?.[0], changes.notes?.[0]);
  const covered = new Set<string>();
  if (preferences.length || previousPreferences.length) {
    const previous = new Map(previousPreferences.map((line) => [line.label, line.value]));
    const labels = [...previousPreferences.map((line) => line.label), ...preferences.map((line) => line.label)];
    for (const label of labels) {
      if (covered.has(label)) continue;
      covered.add(label);
      const before = previous.get(label) ?? "—";
      const after = preferences.find((line) => line.label === label)?.value ?? "—";
      if (before === after) continue;
      lines.push({
        key: `preference:${label}`,
        label,
        text: before === "—" ? after : `${before} → ${after}`,
      });
    }
  }
  for (const [field, [before, after]] of Object.entries(changes)) {
    if (field === "preference_details_json") continue;
    if (field === "notes" && covered.has("Additional requirements")) continue;
    lines.push({
      key: field,
      label: labelFor(field),
      text: `${show(before, field)} → ${show(after, field)}`,
    });
  }
  return lines;
}
