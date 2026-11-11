import type { SqlDb } from "../db/sql";
import { listForms, type StoredForm } from "../meta/forms";
import { CLASSIFICATION_LABEL, type FormClassification } from "../meta/mapping";
import { listIngestions, type IngestionSummary } from "../meta/overview";
import { listOwnerLeads, type OwnerLead } from "./owner-leads";
import { listRequirements, type Requirement } from "./requirements";

const EXCLUDED_CLASSIFICATIONS = new Set<FormClassification>(["unclassified", "ignore"]);
const RETRYABLE = ["failed", "needs_mapping", "waiting_token", "retry"] as const;

export type FormDeskCounts = {
  imported: number;
  held: number;
  duplicates: number;
  excluded: number;
  notFetched: number;
  toRetry: number;
};

/** Queue rows already stored, plus Meta's lifetime count for leads that were never fetched. */
export function formDeskCounts(
  classification: string,
  leadsCount: number | null,
  byStatus: Partial<Record<string, number>>,
): FormDeskCounts {
  const imported = byStatus.done ?? 0;
  const held = byStatus.needs_review ?? 0;
  const duplicates = byStatus.duplicate ?? 0;
  const toRetry = RETRYABLE.reduce<number>((sum, status) => sum + (byStatus[status] ?? 0), 0);
  const queued = Object.values(byStatus).reduce<number>((sum, count) => sum + (count ?? 0), 0);
  const stillOnMeta = Math.max((leadsCount ?? 0) - queued, 0);
  const excluded = EXCLUDED_CLASSIFICATIONS.has(classification as FormClassification) ? stillOnMeta : 0;
  return {
    imported,
    held,
    duplicates,
    excluded,
    notFetched: excluded > 0 ? 0 : stillOnMeta,
    toRetry,
  };
}

export type FormDeskSection = {
  form: StoredForm;
  paused: boolean;
  classificationLabel: string;
  counts: FormDeskCounts;
  ownerLeads: OwnerLead[];
  ownerLeadTotal: number;
  ownerLeadPage: number;
  requirements: Requirement[];
  requirementTotal: number;
  requirementPage: number;
  held: IngestionSummary[];
  retryable: IngestionSummary[];
};

/** Owner leads and requirements shown on one Forms page before the next page. */
export const FORM_RECORD_PAGE = 100;

function listPage(requested: number | undefined, total: number): { page: number; offset: number } {
  const pages = Math.max(1, Math.ceil(total / FORM_RECORD_PAGE));
  const page = Math.min(Math.max(1, Math.floor(requested ?? 1)), pages);
  return { page, offset: (page - 1) * FORM_RECORD_PAGE };
}

async function countByForm(db: SqlDb, table: "owner_leads" | "demand_requirements", alias: "l" | "r") {
  const { results } = await db
    .prepare(
      `SELECT s.meta_form_id AS form_id, COUNT(*) AS n
       FROM ${table} ${alias}
       JOIN lead_sources s ON s.id = ${alias}.source_id
       WHERE s.meta_form_id != ''
       GROUP BY s.meta_form_id`,
    )
    .all<{ form_id: string; n: number }>();
  return new Map(results.map((row) => [row.form_id, row.n]));
}

export async function formDesk(
  db: SqlDb,
  options: { canViewPhone: boolean; pages?: { formId: string; owner?: number; requirement?: number } },
): Promise<FormDeskSection[]> {
  const [forms, grouped, ownerTotals, requirementTotals] = await Promise.all([
    listForms(db),
    db
      .prepare("SELECT form_id, status, COUNT(*) AS n FROM meta_lead_ingestions GROUP BY form_id, status")
      .all<{ form_id: string; status: string; n: number }>(),
    countByForm(db, "owner_leads", "l"),
    countByForm(db, "demand_requirements", "r"),
  ]);
  const byForm = new Map<string, Partial<Record<string, number>>>();
  for (const row of grouped.results) {
    const counts = byForm.get(row.form_id) ?? {};
    counts[row.status] = row.n;
    byForm.set(row.form_id, counts);
  }

  return Promise.all(
    forms.map(async (form) => {
      const ownerLeadTotal = ownerTotals.get(form.formId) ?? 0;
      const requirementTotal = requirementTotals.get(form.formId) ?? 0;
      const requested = options.pages?.formId === form.formId ? options.pages : undefined;
      const owner = listPage(requested?.owner, ownerLeadTotal);
      const requirement = listPage(requested?.requirement, requirementTotal);
      const [ownerLeads, requirements, attention] = await Promise.all([
        listOwnerLeads(db, { formId: form.formId, limit: FORM_RECORD_PAGE, offset: owner.offset }),
        listRequirements(db, { formId: form.formId, limit: FORM_RECORD_PAGE, offset: requirement.offset }),
        listIngestions(db, {
          formId: form.formId,
          statuses: ["needs_review", ...RETRYABLE],
          limit: 100,
          canViewPhone: options.canViewPhone,
        }),
      ]);
      return {
        form,
        paused: Boolean(form.status) && form.status.toUpperCase() !== "ACTIVE",
        classificationLabel: CLASSIFICATION_LABEL[form.classification],
        counts: formDeskCounts(form.classification, form.leadsCount, byForm.get(form.formId) ?? {}),
        ownerLeads,
        ownerLeadTotal,
        ownerLeadPage: owner.page,
        requirements,
        requirementTotal,
        requirementPage: requirement.page,
        held: attention.filter((row) => row.status === "needs_review"),
        retryable: attention.filter((row) => row.status !== "needs_review"),
      };
    }),
  );
}
