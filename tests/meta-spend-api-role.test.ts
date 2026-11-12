import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import type { SqlDb } from "../lib/db/sql";

const state: {
  role: "super_admin" | "inventory_manager" | "lead_executive" | "viewer";
  db: SqlDb | null;
} = { role: "viewer", db: null };

mock.module("server-only", { namedExports: {} });
mock.module("../lib/admin/permissions.ts", {
  namedExports: {
    can: () => true,
    isRole: (value: unknown) => typeof value === "string",
  },
});
mock.module("../lib/db/database.ts", {
  namedExports: {
    requireDatabase: async () => {
      if (!state.db) throw new Error("test database is not ready");
      return state.db;
    },
    getDatabase: async () => state.db,
    DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
    resetDatabaseReady() {},
    getMediaBucket: async () => null,
  },
});
mock.module("../lib/admin/identity.ts", {
  namedExports: {
    getCurrentAdmin: async () => ({
      id: "adm_role",
      email: "role@example.com",
      name: "Role user",
      role: state.role,
      legacy: false,
    }),
    adminCapabilities: () => ({}),
  },
});

const ROLES = ["inventory_manager", "lead_executive", "viewer"] as const;
const ACTIONS = ["list_ad_accounts", "select_ad_account", "import_spend"] as const;
const SPEND_DENIAL = "Only a super admin can choose an ad account or import spend.";

function spendRequest(action: string) {
  return new Request("http://localhost:3000/api/admin/integrations/meta", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ action, accountId: "act_1509113601263131" }),
  });
}

describe("Meta spend API super_admin gate", () => {
  it("still rejects the three roles when integrations.manage is granted, and lets a super admin through", async () => {
    const { createTestDb } = await import("./helpers/sqlite");
    const { prepareDatabase } = await import("../lib/db/prepare");
    state.db = createTestDb();
    await prepareDatabase(state.db, () => [], "2026-11-12T06:00:00.000Z");
    const { POST } = await import("../app/api/admin/integrations/meta/route");

    for (const role of ROLES) {
      state.role = role;
      for (const action of ACTIONS) {
        const response = await POST(spendRequest(action));
        assert.equal(response.status, 403, `${role} ${action}`);
        const body = (await response.json()) as { error?: string };
        assert.equal(body.error, SPEND_DENIAL);
      }
    }

    state.role = "viewer";
    const names = await POST(spendRequest("sync_names"));
    const namesBody = (await names.json()) as { error?: string };
    assert.notEqual(namesBody.error, SPEND_DENIAL);

    state.role = "super_admin";
    const allowed = await POST(spendRequest("import_spend"));
    const allowedBody = (await allowed.json()) as { error?: string };
    assert.notEqual(allowed.status, 403);
    assert.notEqual(allowedBody.error, SPEND_DENIAL);

    const spend = await state.db.prepare("SELECT COUNT(*) AS n FROM ad_spend_daily").first<{ n: number }>();
    assert.equal(spend?.n, 0);
    const account = await state.db.prepare("SELECT ad_account_id FROM meta_connection").first<{ ad_account_id: string }>();
    assert.equal(account?.ad_account_id ?? "", "");
  });

  it("rejects buyer recovery for every role except super admin", async () => {
    const { createTestDb } = await import("./helpers/sqlite");
    const { prepareDatabase } = await import("../lib/db/prepare");
    state.db = createTestDb();
    await prepareDatabase(state.db, () => [], "2026-11-12T06:00:00.000Z");
    const { POST } = await import("../app/api/admin/integrations/meta/route");
    const denial = "Only a super admin can recover historical Buyer & Renter leads.";
    const actions = ["preview_buyer_recovery", "confirm_buyer_recovery", "step_buyer_recovery"];

    for (const role of ROLES) {
      state.role = role;
      for (const action of actions) {
        const response = await POST(spendRequest(action));
        assert.equal(response.status, 403, `${role} ${action}`);
        const body = (await response.json()) as { error?: string };
        assert.equal(body.error, denial);
      }
    }

    const runs = await state.db.prepare("SELECT COUNT(*) AS n FROM meta_buyer_recovery_runs").first<{ n: number }>();
    assert.equal(runs?.n, 0);
    const requirements = await state.db.prepare("SELECT COUNT(*) AS n FROM demand_requirements").first<{ n: number }>();
    assert.equal(requirements?.n, 0);
  });
});
