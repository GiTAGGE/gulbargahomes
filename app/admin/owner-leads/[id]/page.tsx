import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { AddClientRequirement } from "@/components/admin/add-client-requirement";
import { ContactCard, SourceCard } from "@/components/admin/crm-cards";
import { FollowupsPanel, TimelinePanel } from "@/components/admin/crm-panels";
import { HistoryList } from "@/components/admin/history-list";
import { OwnerLeadActions } from "@/components/admin/record-actions";
import { Card, Empty, Field, Pill } from "@/components/admin/ui";
import { listAudit } from "@/lib/admin/audit";
import { availabilityTone, bandTone, budgetLabel, formatDateTime, formatInr, ownerIntentPhrase, ownerPriceLabel, publicationTone, verificationTone } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import { adminNames } from "@/lib/admin/users";
import { listActivities, listFollowups } from "@/lib/crm/activity";
import { getContact, redactContact } from "@/lib/crm/contacts";
import { getOwnerLead } from "@/lib/crm/owner-leads";
import { reviewLabel } from "@/lib/crm/review";
import { listRequirements } from "@/lib/crm/requirements";
import { getSource } from "@/lib/crm/sources";
import { listInventoryForOwnerLead } from "@/lib/inventory/repository";
import { getLocalities } from "@/lib/properties";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function OwnerLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, caps } = await requirePageAdmin("crm.view");
  const { id } = await params;
  const lead = await getOwnerLead(db, id);
  if (!lead) notFound();

  const entity = { entityType: "owner_lead" as const, entityId: lead.id, contactId: lead.contactId };
  const [contact, source, activities, followups, properties, history, names, requirements, localities] = await Promise.all([
    getContact(db, lead.contactId),
    getSource(db, lead.sourceId),
    listActivities(db, { entityType: "owner_lead", entityId: lead.id }),
    listFollowups(db, { entityType: "owner_lead", entityId: lead.id }),
    listInventoryForOwnerLead(db, lead.id, { includeDiscreet: caps.viewDiscreet }),
    caps.viewAudit ? listAudit(db, { entityType: "owner_lead", entityId: lead.id }) : [],
    adminNames(db),
    listRequirements(db, { contactId: lead.contactId, limit: 100 }),
    getLocalities(),
  ]);
  const converted = lead.status === "Converted";

  return (
    <AdminShell
      eyebrow={`${lead.code} · Owner lead`}
      title={lead.contactName}
      action={
        <Link href="/admin/owner-leads" className="btn-ghost hidden sm:inline-flex">
          All owner leads
        </Link>
      }
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card
            title={
              <span className="flex flex-wrap items-center gap-2">
                Wants to {ownerIntentPhrase(lead.intent).toLowerCase()}
                <Pill tone={converted ? "green" : lead.status === "New" ? "amber" : "stone"}>{lead.status}</Pill>
                <Pill tone={lead.roleReview === "genuine" ? "green" : lead.roleReview === "" ? "amber" : "stone"}>
                  {reviewLabel("owner", lead.roleReview)}
                </Pill>
                <Pill tone={bandTone(lead.priority)}>{lead.priority}</Pill>
              </span>
            }
          >
            <dl className="grid gap-3 sm:grid-cols-3">
              <Field label="Property type">{lead.propertyType || "Not known yet"}</Field>
              <Field label="Locality">{lead.locality}</Field>
              <Field label={ownerPriceLabel(lead.intent)}>{formatInr(lead.expectedPrice)}</Field>
              <Field label="Location as given">{lead.locationText}</Field>
              <Field label="Last contacted">{formatDateTime(lead.lastContactedAt)}</Field>
              <Field label="Added">{formatDateTime(lead.createdAt)}</Field>
            </dl>
            {lead.notes && <p className="mt-3 whitespace-pre-line rounded-xl bg-surface-muted/60 p-3 text-sm text-ink">{lead.notes}</p>}
            {lead.statusReason && <p className="mt-2 text-xs text-ink-muted">Status note: {lead.statusReason}</p>}
            {lead.roleReviewNote && <p className="mt-2 text-xs text-ink-muted">Classification note: {lead.roleReviewNote}</p>}
          </Card>

          <Card
            title="Convert / Add Client Requirement"
            hint="Adds a buyer or tenant requirement for this person. It does not change this owner lead and does not create a listing."
          >
            <AddClientRequirement
              ownerLeadId={lead.id}
              canEdit={caps.editCrm}
              localities={Array.from(new Set([...localities, ...site.localities])).sort()}
              requirements={requirements.map((item) => ({
                id: item.id,
                code: item.code,
                intent: item.intent,
                status: item.status,
                budgetLabel: budgetLabel(item.budgetMin, item.budgetMax, item.intent),
                fromThisLead: item.originOwnerLeadId === lead.id,
              }))}
            />
          </Card>

          <Card title="Properties from this owner" hint="Created by staff from this lead. Drafts stay internal until verified and published.">
            {properties.length === 0 ? (
              <Empty>No property records yet.</Empty>
            ) : (
              <ul className="divide-y divide-brand-50">
                {properties.map((property) => (
                  <li key={property.id} className="py-2">
                    <Link href={`/admin/properties/${property.slug}/edit`} className="font-semibold text-brand-800 hover:underline">
                      {property.code} · {property.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Pill tone={verificationTone(property.verificationStatus)}>{property.verificationStatus}</Pill>
                      <Pill tone={publicationTone(property.publicationStatus)}>{property.publicationStatus}</Pill>
                      <Pill tone={availabilityTone(property.status)}>{property.status}</Pill>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Timeline" hint="Calls, WhatsApp messages and notes with this owner about this lead.">
            <TimelinePanel
              entity={entity}
              activities={activities}
              names={names}
              canLog={caps.logActivity}
              canFollowUp={caps.manageFollowups}
            />
          </Card>

          {caps.viewAudit && (
            <Card title="History">
              <HistoryList entries={history} names={names} />
            </Card>
          )}
        </div>

        <div className="space-y-5">
          {(caps.editCrm || caps.createProperty) && (
            <Card title="Actions">
              <OwnerLeadActions
                id={lead.id}
                status={lead.status}
                priority={lead.priority}
                intent={lead.intent}
                rowVersion={lead.rowVersion}
                roleReview={lead.roleReview}
                roleReviewNote={lead.roleReviewNote}
                canEdit={caps.editCrm}
                canConvert={
                  caps.editCrm &&
                  caps.createProperty &&
                  lead.roleReview === "genuine" &&
                  !["Not interested", "Duplicate", "Invalid"].includes(lead.status)
                }
                converted={converted}
              />
            </Card>
          )}
          {contact && (
            <ContactCard
              title={lead.roleReview === "misclassified" || lead.roleReview === "unqualified" ? "Contact" : "Owner"}
              contact={redactContact(contact, caps.viewPhone)}
              canViewPhone={caps.viewPhone}
            />
          )}
          <Card title="Follow-ups">
            <FollowupsPanel entity={entity} followups={followups} names={names} canManage={caps.manageFollowups} />
          </Card>
          <SourceCard source={source} canViewPhone={caps.viewPhone} />
        </div>
      </div>
    </AdminShell>
  );
}
