import {
  asAvailability,
  asPublication,
  asVerification,
  type AvailabilityStatus,
  type LifecycleState,
  type PublicationStatus,
  type VerificationStatus,
} from "../inventory/lifecycle";
import { EMPTY_NEARBY, normalizeProperty } from "../property-normalize";
import type { Property } from "../types";
import { parseJson, type SqlValue } from "./sql";

export type PropertyRow = {
  slug: string;
  title: string;
  listing: Property["listing"];
  status: string;
  property_type: Property["propertyType"];
  bhk: number | null;
  price: number;
  price_suffix: string;
  area: number;
  locality: string;
  city: string;
  facing: Property["facing"];
  vastu: number;
  vegetarian: Property["vegetarian"];
  bachelors: Property["bachelors"];
  family: Property["family"];
  parking: string;
  bathrooms: number;
  furnished: Property["furnished"];
  featured: number;
  is_new: number;
  cover_image: string;
  gallery_json: string;
  videos_json: string;
  published_at: string;
  body: string;
  amenities_json: string;
  rules_json: string;
  nearby_json: string;
  faq_json: string;
  map_query: string;
  updated_at: string;
  id: string;
  code: string;
  verification_status: string;
  publication_status: string;
  discreet_matching: number;
  verified_at: string | null;
  verified_by: string | null;
  rejection_reason: string;
  availability_verified_at: string | null;
  availability_verified_by: string | null;
  availability_valid_days: number;
  availability_expires_at: string | null;
  owner_contact_id: string | null;
  source_owner_lead_id: string | null;
  internal_notes: string;
  created_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  published_by: string | null;
  first_published_at: string | null;
  archived_at: string | null;
  row_version: number;
};

export interface InventoryProperty extends Omit<Property, "status"> {
  status: AvailabilityStatus;
  id: string;
  code: string;
  verificationStatus: VerificationStatus;
  publicationStatus: PublicationStatus;
  discreetMatching: boolean;
  verifiedAt: string | null;
  verifiedBy: string | null;
  rejectionReason: string;
  availabilityVerifiedAt: string | null;
  availabilityVerifiedBy: string | null;
  availabilityValidDays: number;
  availabilityExpiresAt: string | null;
  ownerContactId: string | null;
  sourceOwnerLeadId: string | null;
  internalNotes: string;
  createdAt: string | null;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  publishedBy: string | null;
  firstPublishedAt: string | null;
  archivedAt: string | null;
  rowVersion: number;
}

/** Public mapping: only fields of the public `Property` type, copied one by one. */
export function rowToProperty(row: PropertyRow): Property {
  return normalizeProperty(
    {
      slug: row.slug,
      title: row.title,
      listing: row.listing,
      status: row.status === "Rented" || row.status === "Sold" ? row.status : "Available",
      propertyType: row.property_type,
      bhk: row.bhk,
      price: row.price,
      priceSuffix: row.price_suffix,
      area: row.area,
      locality: row.locality,
      city: row.city,
      facing: row.facing,
      vastu: Boolean(row.vastu),
      vegetarian: row.vegetarian,
      bachelors: row.bachelors,
      family: row.family,
      parking: row.parking,
      bathrooms: row.bathrooms,
      furnished: row.furnished,
      featured: Boolean(row.featured),
      isNew: Boolean(row.is_new),
      coverImage: row.cover_image,
      gallery: parseJson<string[]>(row.gallery_json, []),
      videos: parseJson<unknown>(row.videos_json, []),
      publishedAt: row.published_at,
      amenities: parseJson<string[]>(row.amenities_json, []),
      rules: parseJson<string[]>(row.rules_json, []),
      nearby: parseJson<Property["nearby"]>(row.nearby_json, EMPTY_NEARBY),
      faq: parseJson<Property["faq"]>(row.faq_json, []),
      mapQuery: row.map_query,
    },
    row.body,
    row.published_at,
  );
}

export function rowToInventory(row: PropertyRow): InventoryProperty {
  return {
    ...rowToProperty(row),
    status: asAvailability(row.status),
    id: row.id,
    code: row.code,
    verificationStatus: asVerification(row.verification_status),
    publicationStatus: asPublication(row.publication_status),
    discreetMatching: Boolean(row.discreet_matching),
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by,
    rejectionReason: row.rejection_reason ?? "",
    availabilityVerifiedAt: row.availability_verified_at,
    availabilityVerifiedBy: row.availability_verified_by,
    availabilityValidDays: Number(row.availability_valid_days ?? 0),
    availabilityExpiresAt: row.availability_expires_at,
    ownerContactId: row.owner_contact_id,
    sourceOwnerLeadId: row.source_owner_lead_id,
    internalNotes: row.internal_notes ?? "",
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    publishedBy: row.published_by,
    firstPublishedAt: row.first_published_at,
    archivedAt: row.archived_at,
    rowVersion: Number(row.row_version ?? 1),
  };
}

/**
 * The listing as the public Property shape, for formatters and the editor.
 * Internal-only availabilities (On Hold, Withdrawn) read as Available; the
 * editor never writes status, so this cannot leak back.
 */
export function asListing(property: InventoryProperty): Property {
  const status = property.status === "Rented" || property.status === "Sold" ? property.status : "Available";
  return { ...property, status };
}

export function lifecycleOf(property: InventoryProperty): LifecycleState {
  return {
    listing: property.listing,
    verification: property.verificationStatus,
    publication: property.publicationStatus,
    availability: property.status,
    discreetMatching: property.discreetMatching,
    availabilityVerifiedAt: property.availabilityVerifiedAt,
    availabilityValidDays: property.availabilityValidDays,
  };
}

/** Listing content columns: everything the editor owns. Lifecycle columns are separate. */
export function contentColumns(property: Property): Record<string, SqlValue> {
  return {
    slug: property.slug,
    title: property.title,
    listing: property.listing,
    property_type: property.propertyType,
    bhk: property.bhk,
    price: property.price,
    price_suffix: property.priceSuffix,
    area: property.area,
    locality: property.locality,
    city: property.city,
    facing: property.facing,
    vastu: property.vastu ? 1 : 0,
    vegetarian: property.vegetarian,
    bachelors: property.bachelors,
    family: property.family,
    parking: property.parking,
    bathrooms: property.bathrooms,
    furnished: property.furnished,
    featured: property.featured ? 1 : 0,
    is_new: property.isNew ? 1 : 0,
    cover_image: property.coverImage,
    gallery_json: JSON.stringify(property.gallery),
    videos_json: JSON.stringify(property.videos),
    published_at: property.publishedAt,
    body: property.body,
    amenities_json: JSON.stringify(property.amenities),
    rules_json: JSON.stringify(property.rules),
    nearby_json: JSON.stringify(property.nearby),
    faq_json: JSON.stringify(property.faq),
    map_query: property.mapQuery,
  };
}

export function insertSql(table: string, columns: Record<string, SqlValue>) {
  const names = Object.keys(columns);
  const placeholders = names.map((_, index) => `?${index + 1}`);
  return {
    sql: `INSERT INTO ${table} (${names.join(", ")}) VALUES (${placeholders.join(", ")})`,
    values: names.map((name) => columns[name] ?? null),
  };
}

export function updateSql(
  table: string,
  columns: Record<string, SqlValue>,
  where: Record<string, SqlValue>,
) {
  const names = Object.keys(columns);
  const whereNames = Object.keys(where);
  const set = names.map((name, index) => `${name} = ?${index + 1}`);
  const conditions = whereNames.map((name, index) => `${name} = ?${names.length + index + 1}`);
  return {
    sql: `UPDATE ${table} SET ${set.join(", ")} WHERE ${conditions.join(" AND ")}`,
    values: [...names.map((name) => columns[name] ?? null), ...whereNames.map((name) => where[name] ?? null)],
  };
}
