export const ROLES = ["super_admin", "inventory_manager", "lead_executive", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super admin",
  inventory_manager: "Inventory manager",
  lead_executive: "Lead executive",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTION: Record<Role, string> = {
  super_admin: "Everything, including team accounts.",
  inventory_manager: "Creates, verifies, prices and publishes properties. Works leads.",
  lead_executive: "Works owner leads and requirements, logs calls and confirms availability.",
  viewer: "Read-only. Phone numbers are masked.",
};

export const PERMISSIONS = [
  "property.view",
  "property.view_discreet",
  "property.view_owner_contact",
  "property.create",
  "property.edit",
  "property.edit_price",
  "property.change_availability",
  "property.confirm_availability",
  "property.verify",
  "property.publish",
  "property.archive",
  "crm.view",
  "crm.edit",
  "contact.view_phone",
  "activity.log",
  "followup.manage",
  "analytics.view",
  "audit.view",
  "users.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const INVENTORY_MANAGER: Permission[] = PERMISSIONS.filter(
  (permission) => permission !== "users.manage",
);

const LEAD_EXECUTIVE: Permission[] = [
  "property.view",
  "property.confirm_availability",
  "crm.view",
  "crm.edit",
  "contact.view_phone",
  "activity.log",
  "followup.manage",
];

const VIEWER: Permission[] = ["property.view", "crm.view", "analytics.view"];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  super_admin: new Set(PERMISSIONS),
  inventory_manager: new Set(INVENTORY_MANAGER),
  lead_executive: new Set(LEAD_EXECUTIVE),
  viewer: new Set(VIEWER),
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
