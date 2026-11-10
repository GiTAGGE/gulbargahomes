import type { Permission } from "../admin/permissions";
import type { Listing } from "../types";

export const VERIFICATION_STATUSES = ["Draft", "Pending", "Verified", "Rejected"] as const;
export const PUBLICATION_STATUSES = ["Unpublished", "Published", "Archived"] as const;
export const AVAILABILITY_STATUSES = ["Available", "On Hold", "Rented", "Sold", "Withdrawn"] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number];
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

/** Availability values the public site can display (with their existing badges). */
export const PUBLIC_AVAILABILITY: readonly AvailabilityStatus[] = ["Available", "Rented", "Sold"];

export const DEFAULT_AVAILABILITY_VALID_DAYS: Record<Listing, number> = {
  Rent: 14,
  Sale: 30,
};

export const MAX_AVAILABILITY_VALID_DAYS = 180;

export type LifecycleState = {
  listing: Listing;
  verification: VerificationStatus;
  publication: PublicationStatus;
  availability: AvailabilityStatus;
  discreetMatching: boolean;
  availabilityVerifiedAt: string | null;
  availabilityValidDays: number;
};

/** Columns a lifecycle action may change, in database naming. */
export type LifecyclePatch = Partial<{
  verification_status: VerificationStatus;
  publication_status: PublicationStatus;
  status: AvailabilityStatus;
  discreet_matching: 0 | 1;
  verified_at: string | null;
  verified_by: string | null;
  rejection_reason: string;
  availability_verified_at: string | null;
  availability_verified_by: string | null;
  availability_valid_days: number;
  availability_expires_at: string | null;
  published_by: string | null;
  first_published_at: string | null;
  archived_at: string | null;
}>;

export function asVerification(value: unknown): VerificationStatus {
  return (VERIFICATION_STATUSES as readonly string[]).includes(String(value))
    ? (value as VerificationStatus)
    : "Draft";
}

export function asPublication(value: unknown): PublicationStatus {
  return (PUBLICATION_STATUSES as readonly string[]).includes(String(value))
    ? (value as PublicationStatus)
    : "Unpublished";
}

export function asAvailability(value: unknown): AvailabilityStatus {
  return (AVAILABILITY_STATUSES as readonly string[]).includes(String(value))
    ? (value as AvailabilityStatus)
    : "Available";
}

export function isPubliclyVisible(
  state: Pick<LifecycleState, "verification" | "publication" | "availability">,
): boolean {
  return (
    state.verification === "Verified" &&
    state.publication === "Published" &&
    PUBLIC_AVAILABILITY.includes(state.availability)
  );
}

export function effectiveValidDays(state: Pick<LifecycleState, "listing" | "availabilityValidDays">) {
  return state.availabilityValidDays > 0
    ? Math.min(state.availabilityValidDays, MAX_AVAILABILITY_VALID_DAYS)
    : DEFAULT_AVAILABILITY_VALID_DAYS[state.listing];
}

export function availabilityExpiresAt(
  state: Pick<LifecycleState, "listing" | "availabilityVerifiedAt" | "availabilityValidDays">,
): string | null {
  if (!state.availabilityVerifiedAt) return null;
  const verified = new Date(state.availabilityVerifiedAt).getTime();
  if (Number.isNaN(verified)) return null;
  return new Date(verified + effectiveValidDays(state) * 86_400_000).toISOString();
}

/** Missing or expired availability checks both count as stale. */
export function isAvailabilityStale(
  state: Pick<LifecycleState, "listing" | "availabilityVerifiedAt" | "availabilityValidDays">,
  now: Date = new Date(),
): boolean {
  const expires = availabilityExpiresAt(state);
  if (!expires) return true;
  return now.getTime() >= new Date(expires).getTime();
}

export type MatchMode = "public" | "internal";

/** Why a property cannot enter active matching; empty when it can. */
export function matchingBlockers(state: LifecycleState, now: Date = new Date()): string[] {
  const blockers: string[] = [];
  if (state.publication === "Archived") blockers.push("Archived");
  if (state.verification !== "Verified") {
    blockers.push(
      state.verification === "Pending" ? "Pending verification" : `Not verified (${state.verification})`,
    );
  }
  if (state.availability !== "Available") blockers.push(`Availability is ${state.availability}`);
  if (state.publication === "Unpublished" && !state.discreetMatching) {
    blockers.push("Unpublished and not marked for discreet matching");
  }
  if (isAvailabilityStale(state, now)) {
    blockers.push(
      state.availabilityVerifiedAt
        ? "Availability check expired — reconfirm with the owner"
        : "Availability never confirmed",
    );
  }
  return blockers;
}

/**
 * Public matches: Verified + Available + Published.
 * Internal-only matches: Verified + Available + Unpublished + discreet.
 * Both require a current availability check.
 */
export function matchingMode(state: LifecycleState, now: Date = new Date()): MatchMode | null {
  if (matchingBlockers(state, now).length > 0) return null;
  if (state.publication === "Published") return "public";
  if (state.publication === "Unpublished" && state.discreetMatching) return "internal";
  return null;
}

export type LifecycleAction =
  | { type: "submit_for_verification" }
  | { type: "verify" }
  | { type: "reject"; reason: string }
  | { type: "publish" }
  | { type: "unpublish" }
  | { type: "archive" }
  | { type: "restore" }
  | { type: "set_availability"; status: AvailabilityStatus; confirm?: boolean }
  | { type: "confirm_availability"; validDays?: number }
  | { type: "set_discreet"; enabled: boolean };

export type LifecycleActionType = LifecycleAction["type"];

export const LIFECYCLE_ACTION_PERMISSION: Record<LifecycleActionType, Permission> = {
  submit_for_verification: "property.edit",
  verify: "property.verify",
  reject: "property.verify",
  publish: "property.publish",
  unpublish: "property.publish",
  archive: "property.archive",
  restore: "property.archive",
  set_availability: "property.change_availability",
  confirm_availability: "property.confirm_availability",
  set_discreet: "property.publish",
};

export const LIFECYCLE_ACTION_LABEL: Record<LifecycleActionType, string> = {
  submit_for_verification: "Submit for verification",
  verify: "Mark verified",
  reject: "Reject",
  publish: "Publish on website",
  unpublish: "Unpublish",
  archive: "Archive",
  restore: "Restore from archive",
  set_availability: "Change availability",
  confirm_availability: "Confirm availability",
  set_discreet: "Discreet matching",
};

export type LifecycleResult =
  | { ok: true; patch: LifecyclePatch; next: LifecycleState }
  | { ok: false; error: string };

function fail(error: string): LifecycleResult {
  return { ok: false, error };
}

function applyPatch(state: LifecycleState, patch: LifecyclePatch): LifecycleState {
  return {
    ...state,
    verification: patch.verification_status ?? state.verification,
    publication: patch.publication_status ?? state.publication,
    availability: patch.status ?? state.availability,
    discreetMatching:
      patch.discreet_matching === undefined ? state.discreetMatching : patch.discreet_matching === 1,
    availabilityVerifiedAt:
      patch.availability_verified_at === undefined
        ? state.availabilityVerifiedAt
        : patch.availability_verified_at,
    availabilityValidDays: patch.availability_valid_days ?? state.availabilityValidDays,
  };
}

function confirmPatch(
  state: LifecycleState,
  actorId: string,
  nowIso: string,
  validDays?: number,
): LifecyclePatch | string {
  let days = state.availabilityValidDays;
  if (validDays !== undefined) {
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > MAX_AVAILABILITY_VALID_DAYS) {
      return `Validity must be between 1 and ${MAX_AVAILABILITY_VALID_DAYS} days.`;
    }
    days = validDays;
  }
  const expires = availabilityExpiresAt({
    listing: state.listing,
    availabilityVerifiedAt: nowIso,
    availabilityValidDays: days,
  });
  return {
    availability_verified_at: nowIso,
    availability_verified_by: actorId,
    availability_valid_days: days,
    availability_expires_at: expires,
  };
}

export function applyLifecycleAction(
  state: LifecycleState,
  action: LifecycleAction,
  context: { actorId: string; now: string; firstPublishedAt?: string | null },
): LifecycleResult {
  const archived = state.publication === "Archived";
  if (archived && action.type !== "restore") {
    return fail("Restore this property from the archive first.");
  }

  let patch: LifecyclePatch;

  switch (action.type) {
    case "submit_for_verification":
      if (state.verification !== "Draft" && state.verification !== "Rejected") {
        return fail("Only drafts and rejected properties can be submitted for verification.");
      }
      patch = { verification_status: "Pending", rejection_reason: "" };
      break;

    case "verify":
      if (state.verification !== "Draft" && state.verification !== "Pending") {
        return fail(
          state.verification === "Verified"
            ? "This property is already verified."
            : "Resubmit a rejected property for verification before verifying it.",
        );
      }
      patch = {
        verification_status: "Verified",
        verified_at: context.now,
        verified_by: context.actorId,
        rejection_reason: "",
      };
      break;

    case "reject": {
      const reason = action.reason.trim();
      if (!reason) return fail("Give a reason for rejecting this property.");
      if (state.verification === "Rejected") return fail("This property is already rejected.");
      patch = {
        verification_status: "Rejected",
        rejection_reason: reason.slice(0, 500),
        publication_status: "Unpublished",
        discreet_matching: 0,
      };
      break;
    }

    case "publish":
      if (state.verification !== "Verified") return fail("Verify the property before publishing it.");
      if (state.publication === "Published") return fail("This property is already published.");
      if (!PUBLIC_AVAILABILITY.includes(state.availability)) {
        return fail(`A property that is ${state.availability} cannot be published.`);
      }
      patch = {
        publication_status: "Published",
        published_by: context.actorId,
        discreet_matching: 0,
        ...(context.firstPublishedAt ? {} : { first_published_at: context.now }),
      };
      break;

    case "unpublish":
      if (state.publication !== "Published") return fail("This property is not published.");
      patch = { publication_status: "Unpublished" };
      break;

    case "archive":
      patch = { publication_status: "Archived", discreet_matching: 0, archived_at: context.now };
      break;

    case "restore":
      if (!archived) return fail("This property is not archived.");
      patch = { publication_status: "Unpublished", archived_at: null };
      break;

    case "set_availability": {
      if (!(AVAILABILITY_STATUSES as readonly string[]).includes(action.status)) {
        return fail("Choose a valid availability.");
      }
      if (action.status === state.availability && !action.confirm) {
        return fail(`Availability is already ${action.status}.`);
      }
      patch = { status: action.status };
      if (action.status === "Withdrawn" && state.publication === "Published") {
        patch.publication_status = "Unpublished";
      }
      if (action.confirm && action.status === "Available") {
        const confirmed = confirmPatch(state, context.actorId, context.now);
        if (typeof confirmed === "string") return fail(confirmed);
        patch = { ...patch, ...confirmed };
      }
      break;
    }

    case "confirm_availability": {
      if (state.availability !== "Available") {
        return fail(`Set availability to Available before confirming it (currently ${state.availability}).`);
      }
      const confirmed = confirmPatch(state, context.actorId, context.now, action.validDays);
      if (typeof confirmed === "string") return fail(confirmed);
      patch = confirmed;
      break;
    }

    case "set_discreet":
      if (action.enabled && state.publication !== "Unpublished") {
        return fail("Discreet matching is only for unpublished properties. Unpublish it first.");
      }
      if (action.enabled === state.discreetMatching) {
        return fail(action.enabled ? "Discreet matching is already on." : "Discreet matching is already off.");
      }
      patch = { discreet_matching: action.enabled ? 1 : 0 };
      break;
  }

  return { ok: true, patch, next: applyPatch(state, patch) };
}

/** Actions that would succeed from this state (permissions are checked separately). */
export function availableActions(state: LifecycleState): LifecycleActionType[] {
  const probes: LifecycleAction[] = [
    { type: "submit_for_verification" },
    { type: "verify" },
    { type: "reject", reason: "probe" },
    { type: "publish" },
    { type: "unpublish" },
    { type: "confirm_availability" },
    { type: "set_discreet", enabled: !state.discreetMatching },
    { type: "archive" },
    { type: "restore" },
  ];
  const context = { actorId: "probe", now: new Date().toISOString() };
  const actions = probes
    .filter((action) => applyLifecycleAction(state, action, context).ok)
    .map((action) => action.type);
  if (state.publication !== "Archived") actions.push("set_availability");
  return actions;
}

export function parseLifecycleAction(input: unknown): LifecycleAction | null {
  if (!input || typeof input !== "object") return null;
  const data = input as Record<string, unknown>;
  switch (data.action) {
    case "submit_for_verification":
    case "verify":
    case "publish":
    case "unpublish":
    case "archive":
    case "restore":
      return { type: data.action };
    case "reject":
      return { type: "reject", reason: typeof data.reason === "string" ? data.reason : "" };
    case "set_availability":
      if (!(AVAILABILITY_STATUSES as readonly string[]).includes(String(data.status))) return null;
      return {
        type: "set_availability",
        status: data.status as AvailabilityStatus,
        confirm: data.confirm === true,
      };
    case "confirm_availability": {
      if (data.validDays === undefined || data.validDays === null || data.validDays === "") {
        return { type: "confirm_availability" };
      }
      const validDays = Number(data.validDays);
      return { type: "confirm_availability", validDays };
    }
    case "set_discreet":
      return { type: "set_discreet", enabled: data.enabled === true };
    default:
      return null;
  }
}
