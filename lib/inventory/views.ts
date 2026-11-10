import { asListing, lifecycleOf, type InventoryProperty } from "../db/property-rows";
import { bhkLabel, formatPrice } from "../format";
import { availabilityExpiresAt, isAvailabilityStale, isPubliclyVisible, matchingMode, type MatchMode } from "./lifecycle";

export const INVENTORY_TABS = [
  { key: "live", label: "On website" },
  { key: "pipeline", label: "Pipeline" },
  { key: "reconfirm", label: "Needs reconfirmation" },
  { key: "discreet", label: "Discreet" },
  { key: "offmarket", label: "Off market" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
] as const;

export type InventoryTab = (typeof INVENTORY_TABS)[number]["key"];

export type InventoryRow = {
  id: string;
  code: string;
  slug: string;
  title: string;
  listing: string;
  propertyType: string;
  bhk: number | null;
  locality: string;
  priceLabel: string;
  sizeLabel: string;
  coverImage: string;
  status: string;
  verificationStatus: string;
  publicationStatus: string;
  discreetMatching: boolean;
  isPublic: boolean;
  matchMode: MatchMode | null;
  stale: boolean;
  availabilityExpiresAt: string | null;
  updatedAt: string;
  tabs: InventoryTab[];
};

export function toInventoryRow(property: InventoryProperty, now: Date = new Date()): InventoryRow {
  const state = lifecycleOf(property);
  const isPublic = isPubliclyVisible(state);
  const archived = state.publication === "Archived";
  const stale = isAvailabilityStale(state, now);
  const tabs: InventoryTab[] = ["all"];
  if (archived) tabs.push("archived");
  else {
    if (isPublic) tabs.push("live");
    if (state.verification !== "Verified") tabs.push("pipeline");
    if (
      state.verification === "Verified" &&
      state.availability === "Available" &&
      (state.publication === "Published" || state.discreetMatching) &&
      stale
    ) {
      tabs.push("reconfirm");
    }
    if (state.publication === "Unpublished" && state.discreetMatching) tabs.push("discreet");
    if (
      state.verification === "Verified" &&
      ((state.publication === "Unpublished" && !state.discreetMatching) ||
        state.availability === "On Hold" ||
        state.availability === "Withdrawn")
    ) {
      tabs.push("offmarket");
    }
  }
  return {
    id: property.id,
    code: property.code,
    slug: property.slug,
    title: property.title,
    listing: property.listing,
    propertyType: property.propertyType,
    bhk: property.bhk,
    locality: property.locality,
    priceLabel: formatPrice(asListing(property)),
    sizeLabel: bhkLabel(asListing(property)),
    coverImage: property.coverImage,
    status: property.status,
    verificationStatus: property.verificationStatus,
    publicationStatus: property.publicationStatus,
    discreetMatching: property.discreetMatching,
    isPublic,
    matchMode: matchingMode(state, now),
    stale,
    availabilityExpiresAt: availabilityExpiresAt(state),
    updatedAt: property.updatedAt,
    tabs,
  };
}
