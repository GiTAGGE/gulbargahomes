import { NextResponse } from "next/server";

import { auditStatement } from "@/lib/admin/audit";
import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, HttpError, readJson } from "@/lib/admin/route";
import { nowIso } from "@/lib/db/sql";
import { listForms } from "@/lib/meta/forms";
import { listImportJobs } from "@/lib/meta/imports";
import { INGESTION_STATUSES, processDue, requeueIngestions, type IngestionStatus } from "@/lib/meta/ingest";
import { ingestionStats, listIngestions, recentDeliveries } from "@/lib/meta/overview";
import { metaRuntime } from "@/lib/meta/runtime";
import { candidatePages, disconnectMeta, selectPage, syncForms, testConnection } from "@/lib/meta/setup";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorize(request, "integrations.view");
  if ("response" in auth) return auth.response;
  try {
    const { connection, missing } = await metaRuntime(auth.db);
    const canViewPhone = can(auth.admin.role, "contact.view_phone");
    const [forms, stats, deliveries, attention, jobs] = await Promise.all([
      listForms(auth.db, connection.pageId || undefined),
      ingestionStats(auth.db),
      recentDeliveries(auth.db),
      listIngestions(auth.db, { statuses: ["failed", "needs_review", "needs_mapping", "waiting_token", "retry"], canViewPhone }),
      listImportJobs(auth.db),
    ]);
    return NextResponse.json({ connection, missingSecrets: missing, forms, stats, deliveries, attention, jobs });
  } catch (error) {
    return errorResponse(error);
  }
}

function statusList(value: unknown): IngestionStatus[] {
  return Array.isArray(value)
    ? value.filter((item): item is IngestionStatus => (INGESTION_STATUSES as readonly string[]).includes(item as string))
    : [];
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && /^mli_[0-9a-f]{20}$/.test(id)) : [];
}

export async function POST(request: Request) {
  const auth = await authorize(request, "integrations.manage");
  if ("response" in auth) return auth.response;
  try {
    const body = await readJson(request);
    const { runtime, config, missing } = await metaRuntime(auth.db, new URL(request.url).origin);
    const now = nowIso();
    const needsSecrets = () => {
      if (missing.length) throw new HttpError(400, `Set ${missing.join(", ")} on the Worker first.`);
    };

    switch (body.action) {
      case "list_pages":
        needsSecrets();
        return NextResponse.json({ pages: await candidatePages(auth.db, config, runtime.graph) });
      case "select_page": {
        needsSecrets();
        const pageId = typeof body.pageId === "string" && /^\d{5,40}$/.test(body.pageId) ? body.pageId : "";
        if (!pageId) throw new HttpError(400, "Choose a Page.");
        return NextResponse.json({ ok: true, ...(await selectPage(auth.db, auth.admin, config, runtime.graph, pageId, now)) });
      }
      case "test":
        return NextResponse.json(await testConnection(auth.db, auth.admin, config, missing, runtime.graph, now));
      case "sync_forms":
        needsSecrets();
        return NextResponse.json({ ok: true, ...(await syncForms(auth.db, auth.admin, config, runtime.graph, now)) });
      case "disconnect":
        return NextResponse.json({ ok: true, ...(await disconnectMeta(auth.db, auth.admin, config, runtime.graph, now)) });
      case "process":
        return NextResponse.json({ ok: true, processed: await processDue(runtime, { limit: 25, budgetMs: 20_000 }) });
      case "retry": {
        const ids = idList(body.ids);
        const statuses = statusList(body.statuses);
        const requeued = await requeueIngestions(
          auth.db,
          { ids, statuses: statuses.length ? statuses : ["failed", "needs_review", "waiting_token", "retry"] },
          now,
        );
        await auditStatement(auth.db, {
          actor: auth.admin,
          entityType: "integration",
          entityId: "meta",
          entityLabel: "Meta Lead Ads",
          action: "retry_ingestions",
          context: { requeued, selected: ids.length },
          at: now,
        }).run();
        const processed = await processDue(runtime, { limit: 25, budgetMs: 20_000, ...(ids.length ? { ids } : {}) });
        return NextResponse.json({ ok: true, requeued, processed });
      }
      case "dismiss": {
        const ids = idList(body.ids);
        if (!ids.length) throw new HttpError(400, "Choose the leads to dismiss.");
        for (const id of ids) {
          await auth.db.batch([
            auth.db
              .prepare(
                `UPDATE meta_lead_ingestions SET status = 'ignored', last_error = 'Dismissed by an admin', updated_at = ?1
                 WHERE id = ?2 AND status IN ('failed', 'needs_review', 'needs_mapping')`,
              )
              .bind(now, id),
            auditStatement(auth.db, {
              actor: auth.admin,
              entityType: "integration",
              entityId: "meta",
              entityLabel: "Meta Lead Ads",
              action: "dismiss_ingestion",
              context: { ingestion_id: id },
              at: now,
              onlyIfPreviousChanged: true,
            }),
          ]);
        }
        return NextResponse.json({ ok: true });
      }
      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (error) {
    return errorResponse(error);
  }
}
