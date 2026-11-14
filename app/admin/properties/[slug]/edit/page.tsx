import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { HistoryList } from "@/components/admin/history-list";
import { LifecyclePanel } from "@/components/admin/lifecycle-panel";
import { PropertyEditor } from "@/components/admin/property-editor";
import { Card } from "@/components/admin/ui";
import { listAudit } from "@/lib/admin/audit";
import { requirePageAdmin } from "@/lib/admin/page";
import { can } from "@/lib/admin/permissions";
import { adminNames } from "@/lib/admin/users";
import { getContact } from "@/lib/crm/contacts";
import { getOwnerLead } from "@/lib/crm/owner-leads";
import { formatPhone, maskPhone } from "@/lib/crm/phone";
import { asListing, lifecycleOf } from "@/lib/db/property-rows";
import {
  LIFECYCLE_ACTION_PERMISSION,
  availableActions,
  effectiveValidDays,
  isPubliclyVisible,
  matchingBlockers,
  matchingMode,
} from "@/lib/inventory/lifecycle";
import { getInventoryBySlug } from "@/lib/inventory/repository";
import { getLocalities } from "@/lib/properties";
import { site } from "@/lib/site";

export const dynamic = "force-dynamic";

export default async function EditPropertyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { admin, db, caps } = await requirePageAdmin("property.view");
  const { slug } = await params;
  const property = await getInventoryBySlug(db, slug, { includeDiscreet: caps.viewDiscreet });
  if (!property) notFound();

  const now = new Date();
  const state = lifecycleOf(property);
  const actions = availableActions(state).filter(
    (action) =>
      can(admin.role, LIFECYCLE_ACTION_PERMISSION[action]) && (action !== "set_discreet" || caps.viewDiscreet),
  );
  const [localities, owner, sourceLead, history, names] = await Promise.all([
    getLocalities(),
    property.ownerContactId ? getContact(db, property.ownerContactId) : null,
    property.sourceOwnerLeadId ? getOwnerLead(db, property.sourceOwnerLeadId) : null,
    caps.viewAudit ? listAudit(db, { entityType: "property", entityId: property.id, limit: 100 }) : [],
    caps.viewAudit ? adminNames(db) : {},
  ]);
  const allLocalities = Array.from(new Set([property.locality, ...localities, ...site.localities])).sort();
  const showOwnerPhone = caps.viewPhone && caps.viewOwnerContact;
  const isPublic = isPubliclyVisible(state);

  const side = (
    <div className="space-y-4">
      <LifecyclePanel
        slug={property.slug}
        rowVersion={property.rowVersion}
        verification={property.verificationStatus}
        publication={property.publicationStatus}
        availability={property.status}
        discreet={property.discreetMatching}
        rejectionReason={property.rejectionReason}
        verifiedAt={property.verifiedAt}
        availabilityVerifiedAt={property.availabilityVerifiedAt}
        availabilityExpiresAt={property.availabilityExpiresAt}
        validDays={effectiveValidDays(state)}
        isPublic={isPublic}
        matchMode={matchingMode(state, now)}
        blockers={matchingBlockers(state, now)}
        actions={actions}
        canChangeAvailability={caps.changeAvailability && property.publicationStatus !== "Archived"}
        canSeeDiscreet={caps.viewDiscreet}
      />
      <Card title="Plot dimensions" hint="Stored as text. Not converted from square feet.">
        <p className="break-words text-sm text-ink">{property.plotDimensions || "Not recorded."}</p>
      </Card>
      <Card title="Owner">
        {owner ? (
          <div className="space-y-1 text-sm">
            <Link href={`/admin/contacts/${owner.id}`} className="font-semibold text-brand-800 hover:underline">
              {owner.name}
            </Link>
            <p className="font-mono text-xs text-ink-faint">{owner.code}</p>
            <p className="text-ink-muted">{showOwnerPhone ? formatPhone(owner.phone) : maskPhone(owner.phone)}</p>
            {sourceLead && (
              <p className="text-xs text-ink-muted">
                From owner lead{" "}
                <Link href={`/admin/owner-leads/${sourceLead.id}`} className="font-semibold text-brand-800 hover:underline">
                  {sourceLead.code}
                </Link>
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No owner linked. Properties converted from an owner lead are linked automatically.</p>
        )}
      </Card>
      {caps.viewAudit && (
        <Card title="History" hint="Every change, who made it and when. This record cannot be edited.">
          <HistoryList entries={history} names={names} />
        </Card>
      )}
    </div>
  );

  return (
    <AdminShell
      eyebrow={`${property.code} · Inventory`}
      title={property.title}
      action={
        <Link href="/admin/properties" className="btn-ghost hidden sm:inline-flex">
          Back to inventory
        </Link>
      }
    >
      <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="2xl:order-2">{side}</div>
        <div className="2xl:order-1">
          {caps.editProperty ? (
            <PropertyEditor
              initial={asListing(property)}
              availabilityLabel={property.status}
              mode="edit"
              localities={allLocalities}
              rowVersion={property.rowVersion}
              internalNotes={property.internalNotes}
              plotDimensions={property.plotDimensions}
              isPublic={isPublic}
              permissions={{
                editPrice: caps.editPrice,
                archive: caps.archive && property.publicationStatus !== "Archived",
                changeAvailability: caps.changeAvailability,
              }}
            />
          ) : (
            <Card title="Listing details">
              <p className="text-sm text-ink-muted">Your role can view this property but not edit it.</p>
            </Card>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
