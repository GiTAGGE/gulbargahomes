import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PERMISSIONS, can, type Permission, type Role } from "../lib/admin/permissions";

const MATRIX: Record<Role, Permission[]> = {
  super_admin: [...PERMISSIONS],
  inventory_manager: PERMISSIONS.filter(
    (permission) => permission !== "users.manage" && permission !== "integrations.manage",
  ),
  lead_executive: [
    "property.view",
    "property.confirm_availability",
    "crm.view",
    "crm.edit",
    "match.view",
    "match.manage",
    "contact.view_phone",
    "activity.log",
    "followup.manage",
  ],
  viewer: ["property.view", "crm.view", "match.view", "analytics.view"],
};

describe("role permission matrix", () => {
  for (const [role, allowed] of Object.entries(MATRIX) as [Role, Permission[]][]) {
    it(`${role} has exactly the documented permissions`, () => {
      for (const permission of PERMISSIONS) {
        assert.equal(can(role, permission), allowed.includes(permission), `${role} → ${permission}`);
      }
    });
  }

  it("only inventory managers and super admins can create, price, verify or publish", () => {
    const controlled: Permission[] = [
      "property.create",
      "property.edit_price",
      "property.change_availability",
      "property.verify",
      "property.publish",
      "property.archive",
    ];
    for (const permission of controlled) {
      assert.equal(can("lead_executive", permission), false, permission);
      assert.equal(can("viewer", permission), false, permission);
    }
  });

  it("only super admins manage integration credentials", () => {
    assert.equal(can("super_admin", "integrations.manage"), true);
    for (const role of ["inventory_manager", "lead_executive", "viewer"] as Role[]) {
      assert.equal(can(role, "integrations.manage"), false, role);
    }
    assert.equal(can("lead_executive", "integrations.view"), false);
    assert.equal(can("viewer", "integrations.view"), false);
  });

  it("rejects unknown roles", () => {
    assert.equal(can("owner" as Role, "property.view"), false);
  });
});
