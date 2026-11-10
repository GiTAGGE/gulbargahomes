import { requireDatabase } from "@/lib/db/database";
import { nowIso } from "@/lib/db/sql";
import { readMetaConfig } from "@/lib/meta/config";
import { processDue } from "@/lib/meta/ingest";
import { metaRuntime, runAfterResponse } from "@/lib/meta/runtime";
import { receiveWebhook, verifySubscription } from "@/lib/meta/webhook";

export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

export async function GET(request: Request) {
  const { config } = readMetaConfig();
  const challenge = verifySubscription(config, new URL(request.url).searchParams);
  return challenge ? text(challenge, 200) : text("Forbidden", 403);
}

/**
 * Acknowledge fast: verify, write the lead ids to the queue, answer 200, then
 * fetch and map the leads after the response. A failed write answers 500 so
 * Meta delivers again; the leadgen id keeps redeliveries from duplicating.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const { config } = readMetaConfig();
  let result;
  try {
    const db = await requireDatabase();
    result = await receiveWebhook(db, config, {
      rawBody,
      signature: request.headers.get("x-hub-signature-256"),
      now: nowIso(),
    });
    if (result.status === 200 && result.ids.length) {
      const ids = result.ids;
      await runAfterResponse(async () => {
        const { runtime } = await metaRuntime(db);
        await processDue(runtime, { ids, limit: ids.length, budgetMs: 25_000 });
      });
    }
  } catch (error) {
    console.error("meta webhook failed", error);
    return text("Temporary failure", 500);
  }
  return text(result.body, result.status);
}
