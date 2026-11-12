import { NextResponse } from "next/server";

import { can, type Role } from "../admin/permissions";

/** Account choice and spend import. Other Meta actions stay on integrations.manage alone. */
export const SPEND_API_ACTIONS = ["list_ad_accounts", "select_ad_account", "import_spend"] as const;

export type SpendApiAction = (typeof SPEND_API_ACTIONS)[number];

export function isSpendApiAction(action: string): action is SpendApiAction {
  return (SPEND_API_ACTIONS as readonly string[]).includes(action);
}

/**
 * These three actions require the super_admin role as well as integrations.manage.
 * Returns the 403 the API sends, or null when the action may continue.
 */
export function denySpendApiAction(role: Role, action: string): NextResponse | null {
  if (!isSpendApiAction(action)) return null;
  if (role === "super_admin" && can(role, "integrations.manage")) return null;
  return NextResponse.json(
    { error: "Only a super admin can choose an ad account or import spend." },
    { status: 403 },
  );
}
