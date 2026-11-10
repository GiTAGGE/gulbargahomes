import Link from "next/link";

import { formatDate } from "@/lib/admin/format";
import type { Contact } from "@/lib/crm/contacts";
import { LEAD_CHANNEL_LABEL } from "@/lib/crm/options";
import { formatPhone, maskPhone, whatsappLink } from "@/lib/crm/phone";
import type { LeadSource } from "@/lib/crm/sources";

import { Card, Field } from "./ui";

export function ContactCard({ contact, canViewPhone, title = "Contact" }: { contact: Contact; canViewPhone: boolean; title?: string }) {
  return (
    <Card title={title}>
      <Link href={`/admin/contacts/${contact.id}`} className="font-semibold text-brand-800 hover:underline">
        {contact.name}
      </Link>
      <p className="font-mono text-xs text-ink-faint">{contact.code}</p>
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

export function SourceCard({ source }: { source: LeadSource | null }) {
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
        <Field label="Submitted">{formatDate(source.submittedAt)}</Field>
      </dl>
    </Card>
  );
}
