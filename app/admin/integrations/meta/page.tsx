import { headers } from "next/headers";

import { AdminShell } from "@/components/admin/admin-shell";
import { MetaIntegration } from "@/components/admin/meta-integration";
import { requirePageAdmin } from "@/lib/admin/page";
import { listForms } from "@/lib/meta/forms";
import { LEAD_RETENTION_DAYS, listImportJobs } from "@/lib/meta/imports";
import { ingestionStats, listIngestions, recentDeliveries } from "@/lib/meta/overview";
import { metaRuntime } from "@/lib/meta/runtime";

export const dynamic = "force-dynamic";

export default async function MetaIntegrationPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string; step?: string }>;
}) {
  const { db, caps } = await requirePageAdmin("integrations.view");
  const query = await searchParams;
  const head = await headers();
  const host = head.get("x-forwarded-host") ?? head.get("host") ?? "gulbargahomes.com";
  const proto = head.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const origin = `${proto}://${host}`;

  const { connection, missing, config } = await metaRuntime(db, origin);
  const [forms, stats, deliveries, attention, recent, jobs] = await Promise.all([
    listForms(db, connection.pageId || undefined),
    ingestionStats(db),
    recentDeliveries(db),
    listIngestions(db, {
      statuses: ["failed", "needs_review", "needs_mapping", "waiting_token", "retry"],
      canViewPhone: caps.viewPhone,
    }),
    listIngestions(db, { statuses: ["done", "duplicate"], limit: 10, canViewPhone: caps.viewPhone }),
    listImportJobs(db),
  ]);

  return (
    <AdminShell eyebrow="Integrations" title="Meta Lead Ads">
      <MetaIntegration
        canManage={caps.manageIntegrations}
        connection={connection}
        missingSecrets={missing}
        appId={config.appId}
        graphVersion={config.graphVersion}
        webhookUrl={`${origin}/api/webhooks/meta-leads`}
        redirectUri={config.redirectUri}
        forms={forms}
        stats={stats}
        deliveries={deliveries}
        attention={attention}
        recent={recent}
        jobs={jobs}
        retentionDays={LEAD_RETENTION_DAYS}
        flash={{ error: query.error ?? "", connected: query.connected === "1", choosePage: query.step === "page" }}
      />
    </AdminShell>
  );
}
