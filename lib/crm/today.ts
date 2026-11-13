import { lifecycleOf, type InventoryProperty } from "../db/property-rows";
import type { SqlDb } from "../db/sql";
import { isAvailabilityStale } from "../inventory/lifecycle";
import { listInventory, type InventoryAccess } from "../inventory/repository";
import { listFollowups, type Followup } from "./activity";
import { endOfIstDay } from "./ist";
import { listOwnerLeads, type OwnerLead } from "./owner-leads";
import { URGENT_TIMELINES } from "./options";
import { listRequirements, type Requirement } from "./requirements";

export { endOfIstDay };

export type TodayQueue = {
  followups: Followup[];
  overdueCount: number;
  newOwnerLeads: OwnerLead[];
  urgentRequirements: Requirement[];
  newRequirements: Requirement[];
  pendingVerification: InventoryProperty[];
  staleAvailability: InventoryProperty[];
};

export async function todayQueue(db: SqlDb, access: InventoryAccess, now: Date = new Date()): Promise<TodayQueue> {
  const nowIso = now.toISOString();
  const [followups, ownerLeads, requirements, inventory] = await Promise.all([
    listFollowups(db, { openDueBefore: endOfIstDay(now), limit: 200 }),
    listOwnerLeads(db, { status: "New", limit: 100 }),
    listRequirements(db, { status: "open", limit: 500 }, now),
    listInventory(db, access),
  ]);

  const openUncontacted = requirements.filter((item) => !item.lastContactedAt);
  const live = inventory.filter((item) => item.publicationStatus !== "Archived");

  return {
    followups,
    overdueCount: followups.filter((item) => item.dueAt < nowIso).length,
    newOwnerLeads: [...ownerLeads].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    urgentRequirements: requirements.filter(
      (item) => URGENT_TIMELINES.includes(item.timeline) && item.status !== "Postponed",
    ),
    newRequirements: openUncontacted.filter((item) => !URGENT_TIMELINES.includes(item.timeline)),
    pendingVerification: live.filter((item) => item.verificationStatus === "Pending"),
    staleAvailability: live.filter(
      (item) =>
        item.verificationStatus === "Verified" &&
        item.status === "Available" &&
        (item.publicationStatus === "Published" || item.discreetMatching) &&
        isAvailabilityStale(lifecycleOf(item), now),
    ),
  };
}
