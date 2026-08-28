import type { PropertyStatus } from "./types";

export const PROPERTY_STATUS_OPTIONS = ["Available", "Rented", "Sold"] as const;

export const PROPERTY_STATUS_FILTER_OPTIONS = ["Any", ...PROPERTY_STATUS_OPTIONS] as const;

export function statusLabel(status: PropertyStatus): string {
  if (status === "Rented") return "Rented out";
  if (status === "Sold") return "Sold";
  return "Available";
}

export function isUnavailableStatus(status: PropertyStatus): boolean {
  return status === "Rented" || status === "Sold";
}

export function statusBannerMessage(status: PropertyStatus): string | null {
  if (status === "Rented" || status === "Sold") {
    return "Contact us if you want similar homes.";
  }
  return null;
}

export function statusSortRank(status: PropertyStatus): number {
  if (status === "Available") return 0;
  if (status === "Rented") return 1;
  return 2;
}
