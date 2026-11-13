import { mock } from "node:test";

mock.module("server-only", { namedExports: {} });
mock.module("../../lib/db/database.ts", {
  namedExports: {
    requireDatabase: async () => {
      throw new Error("public request must not reach the database");
    },
    getDatabase: async () => null,
    DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
    resetDatabaseReady() {},
    getMediaBucket: async () => null,
  },
});
mock.module("../../lib/admin/identity.ts", {
  namedExports: {
    getCurrentAdmin: async () => null,
    adminCapabilities: () => ({}),
  },
});

async function expectSignIn(post: (request: Request) => Promise<Response>, path: string) {
  const response = await post(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ status: "Qualified", priority: "Hot" }),
    }),
  );
  if (response.status !== 401) {
    console.error(path, response.status, await response.text());
    process.exit(1);
  }
}

async function main() {
  const { POST: requirements } = await import("../../app/api/admin/requirements/route");
  const { POST: ownerLeads } = await import("../../app/api/admin/owner-leads/route");
  await expectSignIn(requirements, "/api/admin/requirements");
  await expectSignIn(ownerLeads, "/api/admin/owner-leads");
}

void main();
