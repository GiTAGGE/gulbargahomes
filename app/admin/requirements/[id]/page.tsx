import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { ContactCard, SourceCard } from "@/components/admin/crm-cards";
import { FollowupsPanel, TimelinePanel } from "@/components/admin/crm-panels";
import { HistoryList } from "@/components/admin/history-list";
import { RequirementActions } from "@/components/admin/record-actions";
import { Card, Field, Pill } from "@/components/admin/ui";
import { listAudit } from "@/lib/admin/audit";
import { bandTone, budgetLabel, formatDate, formatDateTime } from "@/lib/admin/format";
import { requirePageAdmin } from "@/lib/admin/page";
import { adminNames } from "@/lib/admin/users";
import { listActivities, listFollowups } from "@/lib/crm/activity";
import { getContact, redactContact } from "@/lib/crm/contacts";
import { requirementDetailFields } from "@/lib/enquiry/questions";
import { getRequirement } from "@/lib/crm/requirements";
import { reviewLabel } from "@/lib/crm/review";
import { getSource } from "@/lib/crm/sources";

export const dynamic = "force-dynamic";

export default async function RequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, caps } = await requirePageAdmin("crm.view");
  const { id } = await params;
  const requirement = await getRequirement(db, id);
  if (!requirement) notFound();

  const entity = { entityType: "requirement" as const, entityId: requirement.id, contactId: requirement.contactId };
  const [contact, source, activities, followups, history, names] = await Promise.all([
    getContact(db, requirement.contactId),
    getSource(db, requirement.sourceId),
    listActivities(db, { entityType: "requirement", entityId: requirement.id }),
    listFollowups(db, { entityType: "requirement", entityId: requirement.id }),
    caps.viewAudit ? listAudit(db, { entityType: "requirement", entityId: requirement.id }) : [],
    adminNames(db),
  ]);
  const score = requirement.intentScore;
  const fields = requirementDetailFields({
    ...requirement,
    budgetText: budgetLabel(requirement.budgetMin, requirement.budgetMax, requirement.intent),
    neededByText: formatDate(requirement.neededBy),
    lastContactedText: formatDateTime(requirement.lastContactedAt),
  });
  const notesLabeled = fields.some((field) => field.label === "Additional requirements");

  return (
    <AdminShell
      eyebrow={`${requirement.code} · Requirement`}
      title={requirement.contactName}
      action={
        <Link href="/admin/requirements" className="btn-ghost hidden sm:inline-flex">
          All requirements
        </Link>
      }
    >
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card
            title={
              <span className="flex flex-wrap items-center gap-2">
                Looking to {requirement.intent === "Rent" ? "rent" : "buy"}
                <Pill tone={requirement.status === "New" ? "amber" : "stone"}>{requirement.status}</Pill>
                <Pill tone={requirement.qualityReview === "genuine" ? "green" : requirement.qualityReview === "" ? "amber" : "stone"}>
                  {reviewLabel(requirement.intent === "Buy" ? "buyer" : "tenant", requirement.qualityReview)}
                </Pill>
              </span>
            }
          >
            <dl className="grid gap-3 sm:grid-cols-3">
              {fields.map((field) => (
                <Field key={field.label} label={field.label}>
                  <span className="whitespace-pre-line">{field.value}</span>
                </Field>
              ))}
            </dl>
            {requirement.notes && !notesLabeled && (
              <p className="mt-3 whitespace-pre-line rounded-xl bg-surface-muted/60 p-3 text-sm text-ink">{requirement.notes}</p>
            )}
            {requirement.outcome && <p className="mt-2 text-sm text-ink">Outcome: {requirement.outcome}</p>}
            {requirement.qualityReviewNote && (
              <p className="mt-2 text-xs text-ink-muted">Classification note: {requirement.qualityReviewNote}</p>
            )}
          </Card>

          <Card title="Matching properties" hint="Coming in the next phase.">
            <p className="text-sm text-ink-muted">
              Suggestions will only include verified, available properties with a current owner confirmation: published ones,
              plus discreet ones for authorised staff.
            </p>
          </Card>

          <Card title="Timeline">
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
          <Card title="Intent score" hint={score.overridden ? "Priority set by staff." : "How ready they are to act."}>
            <div className="flex items-center gap-3">
              <p className="text-3xl font-bold text-ink">{score.score}</p>
              <Pill tone={bandTone(score.band)}>{score.band}</Pill>
            </div>
            <ul className="mt-3 space-y-1.5">
              {score.factors.map((factor) => (
                <li key={factor.label} className="text-xs">
                  <div className="flex justify-between text-ink-muted">
                    <span>{factor.label}</span>
                    <span>
                      {factor.points}/{factor.max}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 rounded-full bg-brand-50">
                    <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${(factor.points / factor.max) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          {caps.editCrm && (
            <Card title="Actions">
              <RequirementActions
                id={requirement.id}
                status={requirement.status}
                priorityOverride={requirement.priorityOverride}
                rowVersion={requirement.rowVersion}
                intent={requirement.intent}
                qualityReview={requirement.qualityReview}
                qualityReviewNote={requirement.qualityReviewNote}
              />
            </Card>
          )}
          {contact && <ContactCard contact={redactContact(contact, caps.viewPhone)} canViewPhone={caps.viewPhone} />}
          <Card title="Follow-ups">
            <FollowupsPanel entity={entity} followups={followups} names={names} canManage={caps.manageFollowups} />
          </Card>
          <SourceCard source={source} canViewPhone={caps.viewPhone} />
        </div>
      </div>
    </AdminShell>
  );
}
