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
  requirements: Requirement[];
  held: IngestionSummary[];
  retryable: IngestionSummary[];
};

export async function formDesk(db: SqlDb, options: { canViewPhone: boolean }): Promise<FormDeskSection[]> {
  const [forms, grouped] = await Promise.all([
    listForms(db),
    db
      .prepare("SELECT form_id, status, COUNT(*) AS n FROM meta_lead_ingestions GROUP BY form_id, status")
      .all<{ form_id: string; status: string; n: number }>(),
  ]);
  const byForm = new Map<string, Partial<Record<string, number>>>();
  for (const row of grouped.results) {
    const counts = byForm.get(row.form_id) ?? {};
    counts[row.status] = row.n;
    byForm.set(row.form_id, counts);
  }

  return Promise.all(
    forms.map(async (form) => {
      const [ownerLeads, requirements, attention] = await Promise.all([
        listOwnerLeads(db, { formId: form.formId, limit: 100 }),
        listRequirements(db, { formId: form.formId, limit: 100 }),
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
        requirements,
        held: attention.filter((row) => row.status === "needs_review"),
        retryable: attention.filter((row) => row.status !== "needs_review"),
      };
    }),
  );
}
