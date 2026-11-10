import { NextResponse } from "next/server";

import { requireDatabase } from "@/lib/db/database";
import { readMetaConfig } from "@/lib/meta/config";
import { constantTimeEqual, sweepToken } from "@/lib/meta/crypto";
import { runSweep } from "@/lib/meta/imports";
import { purgeExpiredQueueData } from "@/lib/meta/ingest";
import { metaRuntime } from "@/lib/meta/runtime";

export const dynamic = "force-dynamic";

/** Called by the Worker's cron trigger (worker.ts). Not reachable without the derived token. */
export async function POST(request: Request) {
  const { config } = readMetaConfig();
  const provided = request.headers.get("x-meta-sweep-token") ?? "";
  if (!config.appSecret || !provided || !constantTimeEqual(provided, await sweepToken(config.appSecret))) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const db = await requireDatabase();
    const { runtime, connection } = await metaRuntime(db);
    if (connection.status !== "connected") {
      return NextResponse.json({ skipped: connection.status, purged: await purgeExpiredQueueData(db, new Date()) });
    }
    return NextResponse.json(await runSweep(runtime));
  } catch (error) {
    console.error("meta sweep failed", error);
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}
