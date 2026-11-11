import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { ContactEditor } from "@/components/admin/contact-editor";
import { ContactCard } from "@/components/admin/crm-cards";
import { TimelinePanel } from "@/components/admin/crm-panels";
import { HistoryList } from "@/components/admin/history-list";
import { Card, Empty, Pill } from "@/components/admin/ui";
import { listAudit } from "@/lib/admin/audit";
import { availabilityTone, bandTone, budgetLabel, ownerIntentPhrase, publicationTone, verificationTone } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import { adminNames } from "@/lib/admin/users";
import { listActivities } from "@/lib/crm/activity";
import { getContact, redactContact } from "@/lib/crm/contacts";
import { listOwnerLeads } from "@/lib/crm/owner-leads";
import { listRequirements } from "@/lib/crm/requirements";
import { listInventoryForContact } from "@/lib/inventory/repository";

export const dynamic = "force-dynamic";

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, caps } = await requirePageAdmin("crm.view");
  const { id } = await params;
  const contact = await getContact(db, id);
  if (!contact) notFound();

  const [leads, requirements, properties, activities, history, names] = await Promise.all([
    listOwnerLeads(db, { contactId: id }),
    listRequirements(db, { contactId: id }),
    caps.viewOwnerContact ? listInventoryForContact(db, id, { includeDiscreet: caps.viewDiscreet }) : [],
    listActivities(db, { contactId: id }),
    caps.viewAudit ? listAudit(db, { entityType: "contact", entityId: id }) : [],
    adminNames(db),
  ]);
  const visible = redactContact(contact, caps.viewPhone);

  return (
    <AdminShell eyebrow={`${contact.code} · Contact`} title={contact.name}>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card title="Owner leads">
            {leads.length === 0 ? (
              <Empty>None.</Empty>
            ) : (
              <ul className="divide-y divide-brand-50">
                {leads.map((lead) => (
                  <li key={lead.id} className="flex items-center gap-2 py-2">
                    <Link href={`/admin/owner-leads/${lead.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-800 hover:underline">
                      {lead.code} · {ownerIntentPhrase(lead.intent)} {lead.propertyType} in {lead.locality || lead.locationText}
                    </Link>
                    <Pill tone="stone">{lead.status}</Pill>
                    {lead.roleReview === "misclassified" && <Pill tone="stone">Not an owner</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {caps.viewOwnerContact && (
            <Card title="Properties they own">
              {properties.length === 0 ? (
                <Empty>None.</Empty>
              ) : (
                <ul className="divide-y divide-brand-50">
                  {properties.map((property) => (
                    <li key={property.id} className="py-2">
                      <Link href={`/admin/properties/${property.slug}/edit`} className="text-sm font-semibold text-brand-800 hover:underline">
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
          )}
          <Card title="Requirements">
            {requirements.length === 0 ? (
              <Empty>None.</Empty>
            ) : (
              <ul className="divide-y divide-brand-50">
                {requirements.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 py-2">
                    <Pill tone={bandTone(item.intentScore.band)}>{item.intentScore.score}</Pill>
                    <Link href={`/admin/requirements/${item.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-brand-800 hover:underline">
                      {item.code} · {item.intent} · {budgetLabel(item.budgetMin, item.budgetMax, item.intent)}
                    </Link>
                    <Pill tone="stone">{item.status}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="All interactions" hint="Every call, message and note with this person, across leads and requirements.">
            <TimelinePanel
              entity={{ entityType: "contact", entityId: id, contactId: id }}
              activities={activities}
              names={names}
              canLog={caps.logActivity}
              canFollowUp={false}
            />
          </Card>
          {caps.viewAudit && (
            <Card title="History">
              <HistoryList entries={history} names={names} />
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <ContactCard contact={visible} canViewPhone={caps.viewPhone} />
          {caps.editCrm && (
            <Card title="Edit contact">
              <ContactEditor contact={visible} canEditPhone={caps.viewPhone} />
            </Card>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
