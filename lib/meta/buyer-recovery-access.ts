import { NextResponse } from "next/server";

import { can, type Role } from "../admin/permissions";

/** The explicit Buyer & Renter recovery. Historical import and webhooks are separate actions. */
export const BUYER_RECOVERY_ACTIONS = ["preview_buyer_recovery", "confirm_buyer_recovery", "step_buyer_recovery"] as const;

export function isBuyerRecoveryAction(action: string): boolean {
  return (BUYER_RECOVERY_ACTIONS as readonly string[]).includes(action);
}

/** Super admin as well as integrations.manage. Other roles get 403 even if a test grants the permission. */
export function denyBuyerRecoveryAction(role: Role, action: string): NextResponse | null {
  if (!isBuyerRecoveryAction(action)) return null;
  if (role === "super_admin" && can(role, "integrations.manage")) return null;
  return NextResponse.json(
    { error: "Only a super admin can recover historical Buyer & Renter leads." },
    { status: 403 },
  );
}
