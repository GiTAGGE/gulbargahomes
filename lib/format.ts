import type { Property } from "./types";

export function formatPrice(property: Property): string {
  const { price, priceSuffix, listing } = property;

  if (listing === "Rent") {
    return `\u20B9${price.toLocaleString("en-IN")}${priceSuffix}`;
  }

  if (price >= 10000000) {
    const cr = price / 10000000;
    return `\u20B9${Number(cr.toFixed(2))} Cr`;
  }

  if (price >= 100000) {
    const lakh = price / 100000;
    return `\u20B9${Number(lakh.toFixed(2))} Lakh`;
  }

  return `\u20B9${price.toLocaleString("en-IN")}`;
}

export function bhkLabel(property: Property): string {
  if (property.propertyType === "Plot") return "Plot";
  if (property.bhk === null) return property.propertyType;
  return `${property.bhk} BHK`;
}
