import Link from "next/link";

import { AdminShell } from "@/components/admin/admin-shell";
import { Pill } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import { getConnection } from "@/lib/meta/connection";
import { ingestionStats } from "@/lib/meta/overview";

export const dynamic = "force-dynamic";

const STATUS_TONE = { connected: "green", pending_page: "amber", expired: "red", error: "red", disconnected: "stone" } as const;
const STATUS_LABEL = {
  connected: "Connected",
  pending_page: "Choose a Page",
  expired: "Reconnect needed",
  error: "Error",
  disconnected: "Not connected",
} as const;

export default async function IntegrationsPage() {
  const { db } = await requirePageAdmin("integrations.view");
  const [connection, stats] = await Promise.all([getConnection(db), ingestionStats(db)]);

  return (
    <AdminShell eyebrow="Settings" title="Integrations">
      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href="/admin/integrations/meta"
          className="block rounded-2xl border border-brand-100 bg-white p-5 shadow-soft hover:border-brand-300"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-ink">Meta Lead Ads</h2>
            <Pill tone={STATUS_TONE[connection.status]}>{STATUS_LABEL[connection.status]}</Pill>
          </div>
          <p className="mt-1 text-sm text-ink-muted">
            Facebook and Instagram Instant Form leads arrive as owner leads and rental or purchase requirements.
          </p>
          <p className="mt-3 text-xs text-ink-faint">
            {connection.pageName ? `${connection.pageName} · ` : ""}
            {stats.imported} imported · last lead {formatDateTime(connection.lastSuccessAt)}
            {stats.attention ? ` · ${stats.attention} need attention` : ""}
          </p>
        </Link>
        <div className="rounded-2xl border border-dashed border-brand-200 bg-white/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-ink">WhatsApp Business</h2>
            <Pill>Later phase</Pill>
          </div>
          <p className="mt-1 text-sm text-ink-muted">Log WhatsApp conversations against leads automatically.</p>
        </div>
      </div>
    </AdminShell>
  );
}
