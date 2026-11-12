import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import type { SqlDb } from "../lib/db/sql";

const state: {
  role: "super_admin" | "inventory_manager" | "lead_executive" | "viewer";
  db: SqlDb | null;
} = { role: "viewer", db: null };

mock.module("server-only", { namedExports: {} });
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

function spendRequest(action: string) {
  return new Request("http://localhost:3000/api/admin/integrations/meta", {
    method: "POST",
    headers: { origin: "http://localhost:3000", "content-type": "application/json" },
    body: JSON.stringify({ action, accountId: "act_1509113601263131" }),
  });
}

describe("Meta spend API authorization", () => {
  it("rejects list, select and import for inventory_manager, lead_executive and viewer", async () => {
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
        assert.equal(body.error, "Your role does not allow this.");
      }
    }

    const spend = await state.db.prepare("SELECT COUNT(*) AS n FROM ad_spend_daily").first<{ n: number }>();
    assert.equal(spend?.n, 0);
    const account = await state.db.prepare("SELECT ad_account_id FROM meta_connection").first<{ ad_account_id: string }>();
    assert.equal(account?.ad_account_id ?? "", "");
  });
});
