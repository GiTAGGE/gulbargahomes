"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatDateTime } from "@/lib/admin/format";
import { OPTIONAL_SCOPES, REQUIRED_SCOPES, type OptionalScope } from "@/lib/meta/config";
import type { MetaConnectionView } from "@/lib/meta/connection";
import type { StoredForm } from "@/lib/meta/forms";
import type { ImportJob } from "@/lib/meta/imports";
import { INGESTION_STATUS_LABEL, type IngestionStatus } from "@/lib/meta/labels";
import {
  CLASSIFICATION_LABEL,
  FORM_CLASSIFICATIONS,
  MAPPING_TARGETS,
  TARGET_LABEL,
  suggestMapping,
  type FieldMapping,
  type FormClassification,
} from "@/lib/meta/mapping";
import type { IngestionDetail, IngestionStats, IngestionSummary, WebhookDelivery } from "@/lib/meta/overview";

import { Card, Empty, Pill, Stat, controlClass } from "./ui";

type Props = {
  canManage: boolean;
  connection: MetaConnectionView;
  missingSecrets: string[];
  appId: string;
  graphVersion: string;
  webhookUrl: string;
  redirectUri: string;
  forms: StoredForm[];
  stats: IngestionStats;
  deliveries: WebhookDelivery[];
  attention: IngestionSummary[];
  recent: IngestionSummary[];
  jobs: ImportJob[];
  retentionDays: number;
  flash: { error: string; connected: boolean; choosePage: boolean };
};

const API = "/api/admin/integrations/meta";

async function send<T = Record<string, unknown>>(url: string, method: string, body?: unknown): Promise<{ data?: T; error?: string }> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  return response.ok ? { data } : { error: data.error || "That did not work." };
}

const CONNECTION_TONE = { connected: "green", pending_page: "amber", expired: "red", error: "red", disconnected: "stone" } as const;
const CONNECTION_LABEL = {
  connected: "Connected",
  pending_page: "Choose a Page",
  expired: "Reconnect needed",
  error: "Error",
  disconnected: "Not connected",
} as const;

const STATUS_TONE: Record<IngestionStatus, "green" | "amber" | "red" | "blue" | "stone" | "violet"> = {
  pending: "blue",
  processing: "blue",
  retry: "amber",
  waiting_token: "red",
  needs_mapping: "amber",
  needs_review: "amber",
  done: "green",
  duplicate: "stone",
  ignored: "stone",
  failed: "red",
};

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.parse(iso) - Date.now()) / 86_400_000);
}

function Notice({ tone, children }: { tone: "error" | "ok" | "warn"; children: React.ReactNode }) {
  const style =
    tone === "error" ? "bg-red-50 text-red-800" : tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-brand-50 text-brand-800";
  return (
    <p className={`rounded-xl px-3 py-2 text-sm ${style}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

export function MetaIntegration(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "ok" | "warn"; text: string } | null>(
    props.flash.error
      ? { tone: "error", text: props.flash.error }
      : props.flash.connected
        ? { tone: "ok", text: "Meta reconnected. The Page token was refreshed." }
        : null,
  );

  const act = useCallback(
    async (key: string, url: string, method: string, body?: unknown) => {
      setBusy(key);
      setMessage(null);
      const result = await send(url, method, body);
      setBusy("");
      if (result.error) setMessage({ tone: "error", text: result.error });
      router.refresh();
      return result;
    },
    [router],
  );

  return (
    <div className="space-y-5">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <ConnectionCard {...props} busy={busy} act={act} setMessage={setMessage} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Imported" value={props.stats.imported} />
        <Stat label="Need attention" value={props.stats.attention} tone="alert" />
        <Stat label="Queued / retrying" value={props.stats.byStatus.pending + props.stats.byStatus.processing + props.stats.byStatus.retry} />
        <Stat label="Duplicates skipped" value={props.stats.duplicateLeads} />
        <Stat label="Webhook repeats" value={props.stats.webhookRedeliveries} />
        <Stat label="Matched existing contact" value={props.stats.existingContacts} />
      </div>
      <FormsCard {...props} busy={busy} act={act} />
      <AttentionCard {...props} busy={busy} act={act} />
      <ImportCard {...props} busy={busy} act={act} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <RecentCard recent={props.recent} />
        <WebhookCard {...props} />
      </div>
    </div>
  );
}

type Act = (key: string, url: string, method: string, body?: unknown) => Promise<{ data?: Record<string, unknown>; error?: string }>;

function ConnectionCard({
  canManage,
  connection,
  missingSecrets,
  flash,
  busy,
  act,
  setMessage,
}: Props & { busy: string; act: Act; setMessage: (value: { tone: "error" | "ok" | "warn"; text: string } | null) => void }) {
  const [pages, setPages] = useState<{ id: string; name: string; canManageLeads: boolean }[] | null>(null);
  const [checks, setChecks] = useState<{ label: string; ok: boolean; detail: string }[] | null>(null);
  const [optional, setOptional] = useState<OptionalScope[]>(() =>
    (Object.keys(OPTIONAL_SCOPES) as OptionalScope[]).filter((scope) => connection.scopes.includes(scope)),
  );
  const connectHref = `${API}/connect${optional.length ? `?${optional.map((scope) => `optional=${scope}`).join("&")}` : ""}`;
  const choosing = canManage && connection.awaitingPageChoice && (flash.choosePage || connection.status === "pending_page");

  useEffect(() => {
    if (!choosing) return;
    void send<{ pages: { id: string; name: string; canManageLeads: boolean }[] }>(API, "POST", { action: "list_pages" }).then((result) => {
      if (result.data) setPages(result.data.pages);
      else setMessage({ tone: "error", text: result.error ?? "Could not list Pages." });
    });
  }, [choosing, setMessage]);

  const dataDays = daysUntil(connection.dataAccessExpiresAt);
  const connected = connection.status === "connected";

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          Connection <Pill tone={CONNECTION_TONE[connection.status]}>{CONNECTION_LABEL[connection.status]}</Pill>
        </span>
      }
      hint="One Facebook Page connection serves the owner, tenant and buyer forms."
      action={
        canManage ? (
          <div className="flex flex-wrap justify-end gap-2">
            {(connected || connection.status === "expired") && (
              <button
                type="button"
                className="btn-ghost"
                disabled={Boolean(busy)}
                onClick={async () => {
                  const result = await act("test", API, "POST", { action: "test" });
                  if (result.data) setChecks(result.data.checks as typeof checks);
                }}
              >
                {busy === "test" ? "Testing…" : "Test connection"}
              </button>
            )}
            <a
              href={missingSecrets.length ? undefined : connectHref}
              aria-disabled={missingSecrets.length > 0}
              className={`btn-primary ${missingSecrets.length ? "pointer-events-none opacity-50" : ""}`}
            >
              {connection.status === "disconnected" ? "Connect with Facebook" : "Reconnect"}
            </a>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {missingSecrets.length > 0 && (
          <Notice tone="warn">
            Add these Worker secrets in Cloudflare before connecting: <span className="font-mono">{missingSecrets.join(", ")}</span>.
          </Notice>
        )}
        {connection.status === "expired" && (
          <Notice tone="error">
            Meta stopped accepting the Page token{connection.lastError ? `: ${connection.lastError}` : ""}. New leads are queued
            safely and will import after you reconnect.
          </Notice>
        )}
        {connected && dataDays !== null && dataDays <= 14 && (
          <Notice tone="warn">
            Meta data access ends in {Math.max(dataDays, 0)} days ({formatDateTime(connection.dataAccessExpiresAt)}). Reconnect before
            then to keep leads flowing.
          </Notice>
        )}
        {choosing && (
          <div className="rounded-xl border border-brand-100 p-3">
            <p className="text-sm font-semibold text-ink">Choose the GulbargaHomes Page</p>
            {!pages ? (
              <p className="mt-1 text-sm text-ink-muted">Loading Pages…</p>
            ) : pages.length === 0 ? (
              <p className="mt-1 text-sm text-ink-muted">
                Meta returned no Pages for this Facebook account. Check that the account has a task on the GulbargaHomes Page. If the
                Page is managed only through the Business portfolio, tick the Business portfolio option below and reconnect.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {pages.map((page) => (
                  <li key={page.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm">
                      <span className="font-semibold">{page.name}</span> <span className="font-mono text-xs text-ink-faint">{page.id}</span>
                    </span>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={Boolean(busy)}
                      onClick={async () => {
                        const result = await act(`page-${page.id}`, API, "POST", { action: "select_page", pageId: page.id });
                        if (result.data) {
                          setMessage({ tone: "ok", text: `Connected ${page.name}. ${result.data.forms} forms found. Classify them below.` });
                        }
                      }}
                    >
                      {busy === `page-${page.id}` ? "Connecting…" : "Use this Page"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <dl className="grid gap-3 sm:grid-cols-3">
          <Detail label="Page">{connection.pageName ? `${connection.pageName} (${connection.pageId})` : "—"}</Detail>
          <Detail label="Authorised by">{connection.metaUserName || "—"}</Detail>
          <Detail label="Connected">{formatDateTime(connection.connectedAt)}</Detail>
          <Detail label="Leadgen webhook">{connection.pageId ? (connection.webhookSubscribed ? "Subscribed" : "Not subscribed") : "—"}</Detail>
          <Detail label="Page token">
            {connection.hasPageToken ? (connection.pageTokenExpiresAt ? `Expires ${formatDateTime(connection.pageTokenExpiresAt)}` : "No expiry") : "—"}
          </Detail>
          <Detail label="Data access until">{formatDateTime(connection.dataAccessExpiresAt)}</Detail>
          <Detail label="Last webhook">{formatDateTime(connection.lastWebhookAt)}</Detail>
          <Detail label="Last successful sync">{formatDateTime(connection.lastSuccessAt)}</Detail>
          <Detail label="Last checked">{formatDateTime(connection.lastCheckedAt)}</Detail>
        </dl>
        <div className="space-y-1 text-xs text-ink-faint">
          <p>
            Required: <span className="font-mono">{REQUIRED_SCOPES.join(", ")}</span>
          </p>
          {connection.scopes.length > 0 && (
            <p>
              Granted to this connection: <span className="font-mono">{connection.scopes.join(", ")}</span>. A granted permission
              in testing is not the same as Advanced Access from App Review.
            </p>
          )}
        </div>
        {canManage && (
          <fieldset className="space-y-1 rounded-xl border border-surface-muted p-3 text-sm">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">Optional on next connect</legend>
            {(Object.entries(OPTIONAL_SCOPES) as [OptionalScope, string][]).map(([scope, purpose]) => (
              <label key={scope} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={optional.includes(scope)}
                  onChange={(event) =>
                    setOptional((current) => (event.target.checked ? [...current, scope] : current.filter((item) => item !== scope)))
                  }
                />
                <span>
                  <span className="font-mono text-xs">{scope}</span> — {purpose}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {checks && (
          <ul className="space-y-1 rounded-xl bg-surface-muted/60 p-3 text-sm">
            {checks.map((check) => (
              <li key={check.label}>
                <span className={check.ok ? "text-brand-700" : "text-red-700"}>{check.ok ? "✓" : "✗"}</span>{" "}
                <span className="font-semibold">{check.label}:</span> {check.detail}
              </li>
            ))}
          </ul>
        )}
        {canManage && connection.status !== "disconnected" && (
          <div className="flex flex-wrap gap-2 border-t border-brand-50 pt-3">
            <button
              type="button"
              className="btn-ghost"
              disabled={Boolean(busy) || !connected}
              onClick={async () => {
                const result = await act("sync", API, "POST", { action: "sync_forms" });
                if (result.data) setMessage({ tone: "ok", text: `Forms refreshed: ${result.data.added} new, ${result.data.updated} updated.` });
              }}
            >
              {busy === "sync" ? "Refreshing…" : "Refresh forms"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={Boolean(busy)}
              onClick={() => void act("process", API, "POST", { action: "process" })}
            >
              {busy === "process" ? "Processing…" : "Process queue now"}
            </button>
            <button
              type="button"
              className="btn-ghost text-red-700"
              disabled={Boolean(busy)}
              onClick={async () => {
                if (!window.confirm("Disconnect Meta? New leads will stop arriving until you connect again. Imported leads stay in the CRM.")) return;
                await act("disconnect", API, "POST", { action: "disconnect" });
              }}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

function FormsCard({ canManage, forms, stats, busy, act }: Props & { busy: string; act: Act }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Card
      title="Instant Forms"
      hint="Discovered from the connected Page. Classify each form and confirm how its questions map into the CRM. Unmapped answers are kept on the lead for review."
    >
      {forms.length === 0 ? (
        <Empty>No forms yet. Connect a Page or refresh forms.</Empty>
      ) : (
        <ul className="divide-y divide-brand-50">
          {forms.map((form) => (
            <FormRow
              key={form.formId}
              form={form}
              counts={stats.byForm[form.formId]}
              canManage={canManage}
              open={open === form.formId}
              toggle={() => setOpen(open === form.formId ? null : form.formId)}
              busy={busy}
              act={act}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function FormRow({
  form,
  counts,
  canManage,
  open,
  toggle,
  busy,
  act,
}: {
  form: StoredForm;
  counts?: { imported: number; open: number; attention: number };
  canManage: boolean;
  open: boolean;
  toggle: () => void;
  busy: string;
  act: Act;
}) {
  const [classification, setClassification] = useState<FormClassification>(form.classification);
  const [ownerIntent, setOwnerIntent] = useState(form.ownerIntent);
  const initialMapping = useMemo<FieldMapping>(
    () => (Object.keys(form.mapping).length ? form.mapping : suggestMapping(form.questions, form.classification === "unclassified" ? "tenant" : form.classification)),
    [form],
  );
  const [mapping, setMapping] = useState<FieldMapping>(initialMapping);
  const dirty =
    classification !== form.classification ||
    ownerIntent !== form.ownerIntent ||
    JSON.stringify(mapping) !== JSON.stringify(form.mapping);

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">
            {form.name} {form.status && form.status !== "ACTIVE" && <Pill>{form.status.toLowerCase()}</Pill>}
          </p>
          <p className="text-xs text-ink-faint">
            <span className="font-mono">{form.formId}</span> · {form.questions.length} questions
            {counts ? ` · ${counts.imported} imported` : ""}
            {counts?.attention ? ` · ${counts.attention} need attention` : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`What ${form.name} collects`}
            value={classification}
            disabled={!canManage}
            onChange={(event) => setClassification(event.target.value as FormClassification)}
            className={controlClass}
          >
            {FORM_CLASSIFICATIONS.map((item) => (
              <option key={item} value={item}>
                {CLASSIFICATION_LABEL[item]}
              </option>
            ))}
          </select>
          <button type="button" className="btn-ghost" onClick={toggle} aria-expanded={open}>
            {open ? "Hide mapping" : "Field mapping"}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-3 rounded-xl bg-surface-muted/50 p-3">
          {classification === "owner" && (
            <label className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">If the form does not ask rent or sale, assume</span>
              <select value={ownerIntent} disabled={!canManage} onChange={(event) => setOwnerIntent(event.target.value as typeof ownerIntent)} className={controlClass}>
                <option value="">Rent, and flag it for the call</option>
                <option value="Rent">Rent</option>
                <option value="Sale">Sale</option>
              </select>
            </label>
          )}
          {form.questions.length === 0 ? (
            <p className="text-sm text-ink-muted">Meta did not return the questions for this form.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ink-faint">
                  <th className="py-1 pr-3 font-semibold">Question on the form</th>
                  <th className="py-1 font-semibold">Goes to</th>
                </tr>
              </thead>
              <tbody>
                {form.questions.map((question) => (
                  <tr key={question.key} className="border-t border-brand-50 align-top">
                    <td className="py-2 pr-3">
                      <span className="text-ink">{question.label}</span>
                      <span className="block font-mono text-[11px] text-ink-faint">
                        {question.key} · {question.type.toLowerCase()}
                        {question.options.length ? ` · ${question.options.map((option) => option.value).join(" / ")}` : ""}
                      </span>
                    </td>
                    <td className="py-2">
                      <select
                        aria-label={`Map ${question.label}`}
                        value={mapping[question.key] ?? ""}
                        disabled={!canManage}
                        onChange={(event) => setMapping({ ...mapping, [question.key]: event.target.value as FieldMapping[string] })}
                        className={`${controlClass} w-full`}
                      >
                        {MAPPING_TARGETS.map((target) => (
                          <option key={target} value={target}>
                            {TARGET_LABEL[target]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => setMapping(suggestMapping(form.questions, classification === "unclassified" ? "tenant" : classification))}
              >
                Suggest again
              </button>
            </div>
          )}
        </div>
      )}
      {canManage && dirty && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={Boolean(busy)}
            onClick={() =>
              void act(`form-${form.formId}`, `${API}/forms/${form.formId}`, "PATCH", {
                classification,
                ownerIntent,
                mapping,
                rowVersion: form.rowVersion,
              })
            }
          >
            {busy === `form-${form.formId}` ? "Saving…" : "Save form settings"}
          </button>
          <span className="text-xs text-ink-muted">Leads waiting on this form are imported after saving.</span>
        </div>
      )}
    </li>
  );
}

function AttentionCard({ canManage, attention, busy, act }: Props & { busy: string; act: Act }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<IngestionDetail | null>(null);
  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);

  return (
    <Card
      title="Failed and held leads"
      hint="Leads that could not be imported yet. Nothing here is lost: fix the mapping or reconnect, then retry."
      action={
        canManage && attention.length > 0 ? (
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="btn-ghost"
              disabled={Boolean(busy)}
              onClick={async () => {
                await act("retry", API, "POST", { action: "retry", ids: selected });
                setSelected([]);
              }}
            >
              {busy === "retry" ? "Retrying…" : selected.length ? `Retry ${selected.length} selected` : "Retry all"}
            </button>
            {selected.length > 0 && (
              <button
                type="button"
                className="btn-ghost"
                disabled={Boolean(busy)}
                onClick={async () => {
                  if (!window.confirm("Dismiss the selected leads? They will not be imported.")) return;
                  await act("dismiss", API, "POST", { action: "dismiss", ids: selected });
                  setSelected([]);
                }}
              >
                Dismiss
              </button>
            )}
          </div>
        ) : undefined
      }
    >
      {attention.length === 0 ? (
        <Empty>Nothing needs attention.</Empty>
      ) : (
        <ul className="divide-y divide-brand-50">
          {attention.map((item) => (
            <li key={item.id} className="flex gap-3 py-2">
              {canManage && (
                <input
                  type="checkbox"
                  aria-label={`Select lead ${item.leadgenId}`}
                  checked={selected.includes(item.id)}
                  onChange={() => toggle(item.id)}
                  className="mt-1"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={STATUS_TONE[item.status]}>{INGESTION_STATUS_LABEL[item.status]}</Pill>
                  <span className="text-sm font-semibold text-ink">{item.preview.name || "Unknown name"}</span>
                  {item.preview.phone && <span className="text-sm text-ink-muted">{item.preview.phone}</span>}
                  <span className="text-xs text-ink-faint">{item.formName || item.formId || "Unknown form"}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">{item.lastError}</p>
                <p className="text-[11px] text-ink-faint">
                  Lead <span className="font-mono">{item.leadgenId}</span> · via {item.origin} · received {formatDateTime(item.receivedAt)} ·{" "}
                  {item.attempts} attempt{item.attempts === 1 ? "" : "s"}
                  {item.status === "retry" ? ` · next ${formatDateTime(item.nextAttemptAt)}` : ""}
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost shrink-0 self-start"
                onClick={async () => {
                  if (detail?.id === item.id) return setDetail(null);
                  const result = await send<{ ingestion: IngestionDetail }>(`${API}/ingestions/${item.id}`, "GET");
                  if (result.data) setDetail(result.data.ingestion);
                }}
              >
                {detail?.id === item.id ? "Hide" : "Answers"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail && (
        <div className="mt-3 grid gap-3 rounded-xl bg-surface-muted/50 p-3 sm:grid-cols-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Answers</p>
            {detail.answers.length === 0 ? (
              <p className="text-sm text-ink-muted">Not retrieved from Meta yet.</p>
            ) : (
              <dl className="mt-1 space-y-1 text-sm">
                {detail.answers.map((answer) => (
                  <div key={answer.key}>
                    <dt className="font-mono text-[11px] text-ink-faint">{answer.key}</dt>
                    <dd className="text-ink">{answer.values.join(", ") || "—"}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Processing history</p>
            <ol className="mt-1 space-y-1 text-xs">
              {detail.events.map((event, index) => (
                <li key={index}>
                  <span className="text-ink-faint">{formatDateTime(event.occurredAt)}</span> {event.step} → <b>{event.outcome}</b>
                  {event.message ? ` · ${event.message}` : ""}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Card>
  );
}

const ISO_DAY = (date: Date) => date.toISOString().slice(0, 10);

function ImportCard({ canManage, forms, jobs, retentionDays, connection, busy, act }: Props & { busy: string; act: Act }) {
  const router = useRouter();
  const importable = forms.filter((form) => ["owner", "tenant", "buyer"].includes(form.classification));
  const [formIds, setFormIds] = useState<string[]>([]);
  const today = new Date();
  const [since, setSince] = useState(ISO_DAY(new Date(today.getTime() - 30 * 86_400_000)));
  const [until, setUntil] = useState(ISO_DAY(today));
  const active = jobs.find((job) => job.status === "scanning" || job.status === "processing");
  const [stepping, setStepping] = useState(false);

  useEffect(() => {
    if (!active || !canManage || stepping) return;
    const timer = window.setTimeout(async () => {
      setStepping(true);
      await send(`${API}/imports/${active.id}`, "POST");
      setStepping(false);
      router.refresh();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [active, canManage, stepping, router]);

  return (
    <Card
      title="Historical import"
      hint={`Imports past leads through the same pipeline as the webhook. Meta keeps lead answers for ${retentionDays} days. Already imported leads are counted as duplicates, never created twice.`}
    >
      {canManage && (
        <div className="space-y-3">
          {importable.length === 0 ? (
            <p className="text-sm text-ink-muted">Classify at least one form as owner, tenant or buyer first.</p>
          ) : (
            <>
              <fieldset className="flex flex-wrap gap-3">
                <legend className="sr-only">Forms to import</legend>
                {importable.map((form) => (
                  <label key={form.formId} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formIds.includes(form.formId)}
                      onChange={() =>
                        setFormIds(formIds.includes(form.formId) ? formIds.filter((id) => id !== form.formId) : [...formIds, form.formId])
                      }
                    />
                    {form.name}
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs font-semibold text-ink">
                  From
                  <input
                    type="date"
                    value={since}
                    min={ISO_DAY(new Date(today.getTime() - retentionDays * 86_400_000))}
                    max={until}
                    onChange={(event) => setSince(event.target.value)}
                    className={`${controlClass} mt-1 block`}
                  />
                </label>
                <label className="text-xs font-semibold text-ink">
                  To
                  <input
                    type="date"
                    value={until}
                    min={since}
                    max={ISO_DAY(today)}
                    onChange={(event) => setUntil(event.target.value)}
                    className={`${controlClass} mt-1 block`}
                  />
                </label>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={Boolean(busy) || Boolean(active) || formIds.length === 0 || connection.status !== "connected"}
                  onClick={() => void act("import", `${API}/imports`, "POST", { formIds, since, until })}
                >
                  {busy === "import" ? "Starting…" : "Import leads"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      <ul className={`divide-y divide-brand-50 ${canManage ? "mt-4" : ""}`}>
        {jobs.length === 0 && <Empty>No imports yet.</Empty>}
        {jobs.map((job) => {
          const done = job.progress.byStatus.done ?? 0;
          const settled = Object.entries(job.progress.byStatus)
            .filter(([status]) => !["pending", "processing", "retry"].includes(status))
            .reduce((sum, [, n]) => sum + n, 0);
          const failed = (job.progress.byStatus.failed ?? 0) + (job.progress.byStatus.needs_review ?? 0) + (job.progress.byStatus.needs_mapping ?? 0);
          const percent = job.status === "completed" ? 100 : job.queued ? Math.round((settled / job.queued) * 100) : 0;
          return (
            <li key={job.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Pill tone={job.status === "completed" ? "green" : job.status === "paused" ? "red" : job.status === "cancelled" ? "stone" : "blue"}>
                    {job.status}
                  </Pill>
                  <span>
                    {job.since.slice(0, 10)} → {job.until.slice(0, 10)} · {job.formIds.length} form{job.formIds.length === 1 ? "" : "s"}
                  </span>
                  <span className="text-xs text-ink-faint">started {formatDateTime(job.createdAt)}</span>
                </div>
                {canManage && ["scanning", "processing", "paused"].includes(job.status) && (
                  <div className="flex gap-2">
                    {job.status === "paused" && (
                      <button type="button" className="btn-ghost" disabled={Boolean(busy)} onClick={() => void act(`job-${job.id}`, `${API}/imports/${job.id}`, "POST")}>
                        Resume
                      </button>
                    )}
                    <button type="button" className="btn-ghost" disabled={Boolean(busy)} onClick={() => void act(`job-${job.id}`, `${API}/imports/${job.id}`, "DELETE")}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-50" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-brand-600 transition-all" style={{ width: `${percent}%` }} />
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Scanned form {Math.min(job.progress.formIndex + (job.status === "scanning" ? 1 : 0), job.progress.forms)} of {job.progress.forms} ·{" "}
                {job.found} found · {done} imported · {job.duplicates} duplicates · {failed} need attention
                {job.lastError ? ` · ${job.lastError}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function RecentCard({ recent }: { recent: IngestionSummary[] }) {
  return (
    <Card title="Recently imported">
      {recent.length === 0 ? (
        <Empty>No Meta leads yet.</Empty>
      ) : (
        <ul className="divide-y divide-brand-50">
          {recent.map((item) => {
            const href =
              item.entityType === "owner_lead"
                ? `/admin/owner-leads/${item.entityId}`
                : item.entityType === "requirement"
                  ? `/admin/requirements/${item.entityId}`
                  : null;
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <Pill tone={STATUS_TONE[item.status]}>{INGESTION_STATUS_LABEL[item.status]}</Pill>{" "}
                  {href ? (
                    <Link href={href} className="font-semibold text-brand-800 hover:underline">
                      {item.entityType === "owner_lead" ? "Owner lead" : "Requirement"}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{item.leadgenId}</span>
                  )}{" "}
                  <span className="text-xs text-ink-faint">
                    {item.formName} · via {item.origin}
                    {item.contactExisting ? " · existing contact" : ""}
                  </span>
                </span>
                <span className="text-xs text-ink-faint">{formatDateTime(item.processedAt ?? item.receivedAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function WebhookCard({ deliveries, webhookUrl, redirectUri, appId, graphVersion, missingSecrets }: Props) {
  return (
    <Card title="Webhook activity" hint="Every delivery from Meta, newest first. Invalid signatures are rejected and logged.">
      <dl className="mb-3 grid gap-2 text-xs">
        <Detail label="Callback URL">
          <span className="font-mono">{webhookUrl}</span>
        </Detail>
        <Detail label="OAuth redirect URI">
          <span className="font-mono">{redirectUri}</span>
        </Detail>
        <Detail label="App">
          {appId} · Graph {graphVersion} · verify token {missingSecrets.includes("META_WEBHOOK_VERIFY_TOKEN") ? "not set" : "set"}
        </Detail>
      </dl>
      {deliveries.length === 0 ? (
        <Empty>No deliveries yet.</Empty>
      ) : (
        <ul className="divide-y divide-brand-50 text-sm">
          {deliveries.map((delivery) => (
            <li key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
              <span>
                <Pill tone={delivery.signatureValid ? "green" : "red"}>{delivery.signatureValid ? "Verified" : "Rejected"}</Pill>{" "}
                {delivery.signatureValid
                  ? `${delivery.leadgenCount} lead${delivery.leadgenCount === 1 ? "" : "s"} · ${delivery.newCount} new · ${delivery.repeatCount} repeat`
                  : ""}
                {delivery.note ? <span className="text-xs text-ink-faint"> {delivery.note}</span> : null}
              </span>
              <span className="text-xs text-ink-faint">{formatDateTime(delivery.receivedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
