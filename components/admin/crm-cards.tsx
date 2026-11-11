import Link from "next/link";

import { formatDate, formatDateTime } from "@/lib/admin/format";
import type { Contact } from "@/lib/crm/contacts";
import { LEAD_CHANNEL_LABEL } from "@/lib/crm/options";
import { formatPhone, maskEmail, maskPhone, whatsappLink } from "@/lib/crm/phone";
import type { LeadSource } from "@/lib/crm/sources";

import { Card, Field, Pill } from "./ui";

export function ContactCard({ contact, canViewPhone, title = "Contact" }: { contact: Contact; canViewPhone: boolean; title?: string }) {
  return (
    <Card title={title}>
      <Link href={`/admin/contacts/${contact.id}`} className="font-semibold text-brand-800 hover:underline">
        {contact.name}
      </Link>
      <p className="font-mono text-xs text-ink-faint">{contact.code}</p>
      {(contact.isOwner || contact.isSeeker) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {contact.isOwner && <Pill>Owner</Pill>}
          {contact.isSeeker && <Pill>Seeker</Pill>}
        </div>
      )}
      {contact.doNotContact && (
        <p className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">
          Do not contact{contact.doNotContactReason ? `: ${contact.doNotContactReason}` : ""}
        </p>
      )}
      <p className="mt-2 text-sm text-ink">{canViewPhone ? formatPhone(contact.phone) : maskPhone(contact.phone)}</p>
      {canViewPhone && !contact.doNotContact && (
        <div className="mt-2 flex gap-2">
          <a href={`tel:${contact.phone}`} className="btn-ghost flex-1 justify-center">
            Call
          </a>
          <a
            href={whatsappLink(contact.whatsapp || contact.phone)}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost flex-1 justify-center"
          >
            WhatsApp
          </a>
        </div>
      )}
      {contact.email && <p className="mt-2 text-xs text-ink-muted">{contact.email}</p>}
    </Card>
  );
}

const ORIGIN_LABEL: Record<LeadSource["ingestionOrigin"], string> = {
  manual: "Entered by staff",
  webhook: "Meta webhook",
  historical_import: "Historical import",
  reconciliation: "Reconciliation",
};

type StoredAnswer = { key: string; label?: string; value: string; target: string };

function storedAnswers(source: LeadSource): StoredAnswer[] {
  const answers = source.rawPayload.answers;
  return Array.isArray(answers)
    ? answers.filter((answer): answer is StoredAnswer => Boolean(answer) && typeof answer === "object" && typeof answer.key === "string")
    : [];
}

function maskAnswer(answer: StoredAnswer, canViewPhone: boolean): string {
  if (canViewPhone) return answer.value;
  if (answer.target === "phone" || /phone/.test(answer.key)) return maskPhone(answer.value);
  if (answer.target === "email" || /mail/.test(answer.key)) return maskEmail(answer.value);
  return answer.value;
}

export function SourceCard({ source, canViewPhone = false }: { source: LeadSource | null; canViewPhone?: boolean }) {
  if (!source) {
    return (
      <Card title="Source">
        <p className="text-sm text-ink-muted">Entered manually.</p>
      </Card>
    );
  }
  const meta = source.channel === "meta_lead_form";
  return (
    <Card title="Source">
      <dl className="grid gap-2">
        <Field label="Channel">
          {LEAD_CHANNEL_LABEL[source.channel]}
          {source.platform ? ` · ${source.platform}` : ""}
        </Field>
        {meta && <Field label="Campaign">{source.metaCampaignName}</Field>}
        {meta && source.metaAdsetName && <Field label="Ad set">{source.metaAdsetName}</Field>}
        {meta && source.metaAdName && <Field label="Ad">{source.metaAdName}</Field>}
        {meta && source.metaFormName && <Field label="Form">{source.metaFormName}</Field>}
        {source.metaLeadId && <Field label="Meta lead ID">{source.metaLeadId}</Field>}
        {(source.utmSource || source.utmCampaign) && (
          <Field label="UTM">{[source.utmSource, source.utmMedium, source.utmCampaign].filter(Boolean).join(" / ")}</Field>
        )}
        <Field label="Submitted">{meta ? formatDateTime(source.submittedAt) : formatDate(source.submittedAt)}</Field>
        {meta && source.ingestionOrigin !== "manual" && (
          <Field label="Imported">
            {ORIGIN_LABEL[source.ingestionOrigin]}
            {source.receivedAt ? ` · ${formatDateTime(source.receivedAt)}` : ""}
          </Field>
        )}
      </dl>
      {meta && source.rawPayload.decision && typeof source.rawPayload.decision === "object" ? (
        <p className="mt-3 border-t border-brand-50 pt-3 text-sm text-ink">
          Imported as {(source.rawPayload.decision as { intent?: string }).intent || "—"}
          {(source.rawPayload.decision as { basis?: string }).basis === "staff" ? " (chosen by staff)" : ""}
          {(source.rawPayload.decision as { budgetBasis?: string }).budgetBasis
            ? ` · ${(source.rawPayload.decision as { budgetBasis: string }).budgetBasis === "monthly" ? "monthly rent" : (source.rawPayload.decision as { budgetBasis: string }).budgetBasis === "purchase" ? "purchase budget" : "expected price"}`
            : ""}
        </p>
      ) : null}
      {meta && storedAnswers(source).length > 0 && (
        <div className="mt-3 border-t border-brand-50 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Form answers</p>
          <ul className="mt-1 space-y-1.5">
            {storedAnswers(source).map((answer) => (
              <li key={answer.key} className="text-sm">
                <span className="text-ink-muted">{answer.label || answer.key}</span>
                {!answer.target && (
                  <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-semibold text-amber-800">not mapped</span>
                )}
                <span className="block break-words text-ink">{maskAnswer(answer, canViewPhone) || "—"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
