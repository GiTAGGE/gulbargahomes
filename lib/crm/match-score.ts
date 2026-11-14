import { localitiesMatch } from "../locality";
import { areNeighbouringLocalities } from "./locality-neighbours";
import { parsePlotDimensions, samePlotSize, type PlotSize } from "./plot-size";

/** Locality and area outweigh budget. Preferences can never overturn a locality gap. */
export const MATCH_WEIGHTS = {
  locality: 40,
  nearbyLocality: 22,
  area: 35,
  areaClose: 20,
  areaShort: 8,
  areaShape: 12,
  budget: 25,
  budgetStretch: 14,
  budgetOver: 4,
  preferences: 10,
} as const;

/** A property may cost this much more than the maximum budget and stay a stretch match. */
export const BUDGET_STRETCH_RATIO = 0.15;

export type MatchIntent = "Rent" | "Buy";

export type MatchRequest = {
  intent: MatchIntent;
  propertyTypes: string[];
  localities: string[];
  localityFlexible: boolean;
  areaMin: number | null;
  plotArea: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  bhkMin: number | null;
  bhkMax: number | null;
  furnishing: string;
  vegetarian: string;
  parkingRequired: boolean;
};

export type MatchListing = {
  listing: "Rent" | "Sale";
  propertyType: string;
  locality: string;
  area: number;
  plotDimensions: string;
  price: number;
  bhk: number | null;
  furnished: string;
  vegetarian: string;
  parking: string;
  mode: "public" | "internal";
};

export type ScoredMatch = {
  eligible: true;
  score: number;
  localityScore: number;
  areaScore: number;
  budgetScore: number;
  explanation: string;
  mode: "public" | "internal";
};

export type RejectedMatch = { eligible: false; reason: string };

export function scoreMatch(request: MatchRequest, listing: MatchListing): ScoredMatch | RejectedMatch {
  const compatibility = compatible(request, listing);
  if (compatibility) return { eligible: false, reason: compatibility };

  const locality = scoreLocality(request, listing.locality);
  if (!locality.ok) return { eligible: false, reason: locality.reason };

  const area = scoreArea(request, listing);
  const budget = scoreBudget(request, listing.price);
  const preferences = scorePreferences(request, listing);
  const score = locality.points + area.points + budget.points + preferences.points;
  const lines = [
    `Score ${score} = locality ${locality.points} + area ${area.points} + budget ${budget.points} + preferences ${preferences.points}.`,
    locality.detail,
    area.detail,
    budget.detail,
    ...preferences.lines,
  ];
  return {
    eligible: true,
    score,
    localityScore: locality.points,
    areaScore: area.points,
    budgetScore: budget.points,
    explanation: lines.join("\n"),
    mode: listing.mode,
  };
}

export function stretchLimit(maximum: number): number {
  return maximum + Math.round(maximum * BUDGET_STRETCH_RATIO);
}

function compatible(request: MatchRequest, listing: MatchListing): string | null {
  const expected = request.intent === "Rent" ? "Rent" : "Sale";
  if (listing.listing !== expected) {
    return request.intent === "Rent"
      ? "Rent requirements are matched with rental inventory only."
      : "Buy requirements are matched with sale inventory only.";
  }
  if (request.propertyTypes.length === 0) {
    return "No property type was requested, so nothing is matched.";
  }
  if (!request.propertyTypes.includes(listing.propertyType)) {
    return `${listing.propertyType} is not one of the requested types (${request.propertyTypes.join(", ")}).`;
  }
  return null;
}

function scoreLocality(
  request: MatchRequest,
  locality: string,
): { ok: true; points: number; detail: string } | { ok: false; reason: string } {
  if (request.localities.length === 0) {
    return {
      ok: true,
      points: 0,
      detail: "Locality: not scored. No locality was requested, so this did not count for or against the property.",
    };
  }
  const exact = request.localities.find((requested) => localitiesMatch(requested, locality));
  if (exact) {
    return {
      ok: true,
      points: MATCH_WEIGHTS.locality,
      detail: `Locality: ${MATCH_WEIGHTS.locality}/${MATCH_WEIGHTS.locality}. ${locality} is a locality the client asked for.`,
    };
  }
  if (!request.localityFlexible) {
    return {
      ok: false,
      reason: `${locality} is not a requested locality, and nearby areas were not accepted.`,
    };
  }
  const neighbour = request.localities.find((requested) => areNeighbouringLocalities(requested, locality));
  if (!neighbour) {
    return {
      ok: false,
      reason: `${locality} is not a requested locality or a reviewed neighbour of one.`,
    };
  }
  return {
    ok: true,
    points: MATCH_WEIGHTS.nearbyLocality,
    detail: `Locality: ${MATCH_WEIGHTS.nearbyLocality}/${MATCH_WEIGHTS.locality}. ${locality} is a neighbouring locality of ${neighbour}, and the client said nearby areas are fine.`,
  };
}

function scoreArea(request: MatchRequest, listing: MatchListing): { points: number; detail: string } {
  const requestedSize = request.plotArea ? parsePlotDimensions(request.plotArea) : null;
  const listedSize = parsePlotDimensions(listing.plotDimensions);
  const requestedArea = request.areaMin && request.areaMin > 0 ? request.areaMin : null;
  const listedArea = listing.area > 0 ? listing.area : null;
  const squareFeet = requestedArea && listedArea ? scoreSquareFeet(requestedArea, listedArea) : null;
  const dimensions = requestedSize && listedSize ? scoreDimensions(requestedSize, listedSize) : null;

  if (squareFeet && dimensions) {
    const points = Math.min(squareFeet.points, dimensions.points);
    return {
      points,
      detail: `Area: ${points}/${MATCH_WEIGHTS.area}. ${squareFeet.detail} ${dimensions.detail}`,
    };
  }
  if (squareFeet) {
    const unread = requestedSize
      ? " The property has no plot dimensions, so the requested dimensions were not compared and were not inferred from the square feet."
      : listedSize
        ? " The requirement has no plot dimensions, so the property dimensions were not compared."
        : "";
    return { points: squareFeet.points, detail: `Area: ${squareFeet.points}/${MATCH_WEIGHTS.area}. ${squareFeet.detail}${unread}` };
  }
  if (dimensions) {
    const unread = requestedArea
      ? " The property has no square feet, so the requested area was not compared and dimensions were not converted into square feet."
      : listedArea
        ? " The requirement has no square-foot minimum, so the property area was not compared."
        : "";
    return { points: dimensions.points, detail: `Area: ${dimensions.points}/${MATCH_WEIGHTS.area}. ${dimensions.detail}${unread}` };
  }

  return { points: 0, detail: `Area: not scored. ${uncomparedArea(request, listing, requestedSize, listedSize)}` };
}

function scoreSquareFeet(minimum: number, actual: number): { points: number; detail: string } {
  if (actual >= minimum) {
    return { points: MATCH_WEIGHTS.area, detail: `${formatSqft(actual)} meets the ${formatSqft(minimum)} minimum.` };
  }
  if (actual >= minimum * 0.9) {
    return {
      points: MATCH_WEIGHTS.areaClose,
      detail: `${formatSqft(actual)} is just under the ${formatSqft(minimum)} minimum.`,
    };
  }
  return {
    points: MATCH_WEIGHTS.areaShort,
    detail: `${formatSqft(actual)} is below the ${formatSqft(minimum)} minimum.`,
  };
}

function scoreDimensions(requested: PlotSize, listed: PlotSize): { points: number; detail: string } {
  if (samePlotSize(requested, listed)) {
    return { points: MATCH_WEIGHTS.area, detail: `Plot dimensions ${listed.label} match the requested ${requested.label}.` };
  }
  return {
    points: MATCH_WEIGHTS.areaShape,
    detail: `Plot dimensions are ${listed.label}; the request was ${requested.label}.`,
  };
}

function uncomparedArea(
  request: MatchRequest,
  listing: MatchListing,
  requestedSize: PlotSize | null,
  listedSize: PlotSize | null,
): string {
  const wantsFeet = Boolean(request.areaMin && request.areaMin > 0);
  const hasFeet = listing.area > 0;
  const wantsSize = Boolean(request.plotArea?.trim());
  if (!wantsFeet && !wantsSize && !hasFeet && !listedSize) {
    return "Neither the requirement nor the property has an area or plot dimensions.";
  }
  if (wantsSize && !requestedSize && hasFeet) {
    return `The plot size “${request.plotArea}” is not a dimension pair, and it was not read as square feet. The property’s ${formatSqft(listing.area)} was not used to invent dimensions.`;
  }
  if ((wantsFeet && !hasFeet && listedSize) || (requestedSize && hasFeet && !listedSize)) {
    return "The requirement and the property use different measurements, so area was not treated as a mismatch and dimensions were not converted into square feet.";
  }
  if (wantsFeet && !hasFeet) return "The property has no square footage, so the requested area could not be compared.";
  if (requestedSize && !listedSize) return "The property has no plot dimensions, so the requested dimensions could not be compared.";
  if (!wantsFeet && !wantsSize) return "No area or plot size was requested.";
  return "The available measurements could not be compared. Nothing was inferred.";
}

function scoreBudget(request: MatchRequest, price: number): { points: number; detail: string } {
  if (request.budgetMax === null || request.budgetMax <= 0) {
    return { points: 0, detail: "Budget: not scored. No maximum budget was given." };
  }
  if (price <= 0) {
    return { points: 0, detail: "Budget: not scored. This property has no price, so it was not treated as over or under budget." };
  }
  const maximum = request.budgetMax;
  const minimumNote =
    request.budgetMin && price < request.budgetMin
      ? ` It is below the stated minimum of ${formatRupees(request.budgetMin)}.`
      : "";
  if (price <= maximum) {
    return {
      points: MATCH_WEIGHTS.budget,
      detail: `Budget: ${MATCH_WEIGHTS.budget}/${MATCH_WEIGHTS.budget}. ${formatRupees(price)} is within the ${formatRupees(maximum)} maximum.${minimumNote}`,
    };
  }
  const limit = stretchLimit(maximum);
  const gap = price - maximum;
  if (price <= limit) {
    return {
      points: MATCH_WEIGHTS.budgetStretch,
      detail: `Budget: ${MATCH_WEIGHTS.budgetStretch}/${MATCH_WEIGHTS.budget}. ${formatRupees(price)} is ${formatRupees(gap)} above the ${formatRupees(maximum)} maximum, inside the 15% stretch of ${formatRupees(limit)}.`,
    };
  }
  return {
    points: MATCH_WEIGHTS.budgetOver,
    detail: `Budget: ${MATCH_WEIGHTS.budgetOver}/${MATCH_WEIGHTS.budget}. ${formatRupees(price)} is ${formatRupees(gap)} above the ${formatRupees(maximum)} maximum, past the 15% stretch of ${formatRupees(limit)}. It stays visible at a lower rank.`,
  };
}

function scorePreferences(
  request: MatchRequest,
  listing: MatchListing,
): { points: number; lines: string[] } {
  const lines: string[] = [];
  let points = 0;
  const room = () => MATCH_WEIGHTS.preferences - points;

  if ((request.bhkMin !== null || request.bhkMax !== null) && room() > 0) {
    if (listing.bhk === null) {
      lines.push("BHK: not scored. This property has no BHK, so it was not treated as a match or a miss.");
    } else if (inRange(listing.bhk, request.bhkMin, request.bhkMax)) {
      const award = Math.min(4, room());
      points += award;
      lines.push(`BHK: +${award}. ${listing.bhk} BHK is inside ${rangeLabel(request.bhkMin, request.bhkMax)}.`);
    } else {
      lines.push(`BHK: +0. ${listing.bhk} BHK is outside ${rangeLabel(request.bhkMin, request.bhkMax)}.`);
    }
  }

  if (request.furnishing && request.furnishing !== "Any" && room() >= 0) {
    if (!listing.furnished) {
      lines.push("Furnishing: not scored. This property has no furnishing recorded.");
    } else if (listing.furnished === request.furnishing) {
      const award = Math.min(3, room());
      points += award;
      lines.push(`Furnishing: +${award}. ${listing.furnished} matches the request.`);
    } else {
      lines.push(`Furnishing: +0. The property is ${listing.furnished}; the request is ${request.furnishing}.`);
    }
  }

  if ((request.vegetarian === "Yes" || request.vegetarian === "Preferred") && room() >= 0) {
    if (!listing.vegetarian) {
      lines.push("Vegetarian: not scored. This property has no vegetarian preference recorded.");
    } else if (listing.vegetarian === "Yes" || listing.vegetarian === "Preferred") {
      const award = Math.min(2, room());
      points += award;
      lines.push(`Vegetarian: +${award}. The property is marked ${listing.vegetarian}.`);
    } else {
      lines.push("Vegetarian: +0. The property does not require a vegetarian household.");
    }
  }

  if (request.parkingRequired && room() >= 0) {
    const parking = listing.parking.trim();
    if (!parking) {
      lines.push("Parking: not scored. This property does not list parking, so the request was not marked met or missed.");
    } else if (/^(no|none|nil|not available|without)$/i.test(parking)) {
      lines.push(`Parking: +0. Parking is listed as “${parking}”.`);
    } else {
      const award = Math.min(2, room());
      points += award;
      lines.push(`Parking: +${award}. Parking is listed as “${parking}”.`);
    }
  }

  return { points, lines };
}

function inRange(value: number, minimum: number | null, maximum: number | null): boolean {
  if (minimum !== null && value < minimum) return false;
  if (maximum !== null && value > maximum) return false;
  return true;
}

function rangeLabel(minimum: number | null, maximum: number | null): string {
  if (minimum !== null && maximum !== null && minimum !== maximum) return `${minimum}–${maximum} BHK`;
  if (minimum !== null) return `${minimum} BHK or more`;
  return `up to ${maximum} BHK`;
}

function formatSqft(value: number): string {
  return `${value.toLocaleString("en-IN")} sq ft`;
}

export function formatRupees(value: number): string {
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

/** Rupee gap between a property price and the requirement's maximum. Not a score. */
export function budgetDifferenceLabel(price: number, budgetMax: number | null): string {
  if (budgetMax === null || budgetMax <= 0) return "No maximum budget on the requirement.";
  if (price <= 0) return "This property has no price to compare.";
  if (price <= budgetMax) return `${formatRupees(budgetMax - price)} under the maximum.`;
  return `${formatRupees(price - budgetMax)} over the maximum.`;
}
