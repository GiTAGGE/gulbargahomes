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
  if (property.propertyType === "Commercial") return "Commercial";
  if (property.propertyType === "PG") return "Room";
  if (property.bhk === null) return property.propertyType;
  if (property.bhk === 1 && /1\s*RK/i.test(property.title)) return "1 RK";
  return `${property.bhk} BHK`;
}
