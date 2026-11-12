import { NextResponse } from "next/server";

import { auditStatement } from "@/lib/admin/audit";
import { can } from "@/lib/admin/permissions";
import { authorize, errorResponse, HttpError, readJson } from "@/lib/admin/route";
import { nowIso } from "@/lib/db/sql";
import { listForms } from "@/lib/meta/forms";
import { listImportJobs } from "@/lib/meta/imports";
import {
  dismissIngestions,
  processDue,
  processIngestion,
  resolveIngestionIntent,
  requeueIngestions,
} from "@/lib/meta/ingest";
import { ingestionStats, listIngestions, recentDeliveries } from "@/lib/meta/overview";
import { metaRuntime } from "@/lib/meta/runtime";
import { syncCampaignNames } from "@/lib/meta/names";
import { importCampaignSpend, listMarketingAccounts, selectMarketingAccount } from "@/lib/meta/spend";
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
        return NextResponse.json({ pages: await candidatePages(auth.db, config, runtime.graph, now) });
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
      case "sync_names":
        needsSecrets();
        return NextResponse.json({ ok: true, ...(await syncCampaignNames(auth.db, auth.admin, config.tokenKey, runtime.graph, now)) });
      case "list_ad_accounts":
        needsSecrets();
        return NextResponse.json({ accounts: await listMarketingAccounts(auth.db, config.tokenKey, runtime.graph, now) });
      case "select_ad_account": {
        needsSecrets();
        const accountId = typeof body.accountId === "string" && /^act_\d{3,32}$/.test(body.accountId) ? body.accountId : "";
        if (!accountId) throw new HttpError(400, "Choose an ad account.");
        return NextResponse.json({ ok: true, ...(await selectMarketingAccount(auth.db, auth.admin, config.tokenKey, runtime.graph, accountId, now)) });
      }
      case "import_spend":
        needsSecrets();
        return NextResponse.json({ ok: true, ...(await importCampaignSpend(auth.db, auth.admin, config.tokenKey, runtime.graph, now)) });
      case "disconnect":
        return NextResponse.json({ ok: true, ...(await disconnectMeta(auth.db, auth.admin, config, runtime.graph, now)) });
      case "process":
        return NextResponse.json({ ok: true, processed: await processDue(runtime, { limit: 25, budgetMs: 20_000 }) });
      case "retry": {
        const ids = idList(body.ids);
        const formId = typeof body.formId === "string" && /^\d{5,40}$/.test(body.formId) ? body.formId : "";
        if (!ids.length || !formId) throw new HttpError(400, "Choose one form and the leads on it to retry.");
        const requeued = await requeueIngestions(auth.db, { ids, formId }, now);
        await auditStatement(auth.db, {
          actor: auth.admin,
          entityType: "integration",
          entityId: "meta",
          entityLabel: "Meta Lead Ads",
          action: "retry_ingestions",
          context: { requeued, selected: ids.length, form_id: formId },
          at: now,
        }).run();
        const processed = await processDue(runtime, { limit: 25, budgetMs: 20_000, ids });
        return NextResponse.json({ ok: true, requeued, processed });
      }
      case "import_as": {
        const id = typeof body.id === "string" && /^mli_[0-9a-f]{20}$/.test(body.id) ? body.id : "";
        const intent = typeof body.intent === "string" ? body.intent : "";
        if (!id) throw new HttpError(400, "Choose the lead.");
        const decision = await resolveIngestionIntent(auth.db, auth.admin, id, intent, now);
        if (!decision.ready) {
          return NextResponse.json({ ok: true, already: true, entityType: decision.entityType, entityId: decision.entityId });
        }
        const outcome = await processIngestion(runtime, id);
        const saved = await auth.db
          .prepare("SELECT entity_type, entity_id FROM meta_lead_ingestions WHERE id = ?1")
          .bind(id)
          .first<{ entity_type: string | null; entity_id: string | null }>();
        return NextResponse.json({ ok: true, outcome, entityType: saved?.entity_type ?? null, entityId: saved?.entity_id ?? null });
      }
      case "dismiss": {
        const ids = idList(body.ids);
        if (!ids.length) throw new HttpError(400, "Choose the leads to dismiss.");
        const dismissed = await dismissIngestions(auth.db, auth.admin, ids, now);
        return NextResponse.json({ ok: true, dismissed });
      }
      default:
        throw new HttpError(400, "Unknown action.");
    }
  } catch (error) {
    return errorResponse(error);
  }
}
