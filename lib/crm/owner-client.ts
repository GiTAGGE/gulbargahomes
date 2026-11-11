import { auditStatement, diffFields, type AuditActor } from "../admin/audit";
import { HttpError, isUniqueViolation } from "../admin/errors";
import { formatCode, newId, nextSequence, type SqlDb, type SqlStatement, type SqlValue } from "../db/sql";
import { resolveContact } from "./contacts";
import { text } from "./input";
import { getOwnerLead } from "./owner-leads";
import { getRequirement, requirementColumns, type Requirement, type RequirementInput } from "./requirements";
import { getSource, insertSourceStatement, type SourceInput } from "./sources";

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export type ClientRequirementResult = {
  requirements: Requirement[];
  created: boolean;
};

function storageKey(idempotencyKey: string, intent: RequirementInput["intent"]): string {
  return `${idempotencyKey}:${intent}`;
}

function manualSource(
  lead: { id: string; code: string },
  original: { metaFormName: string; metaCampaignName: string; metaLeadId: string | null } | null,
  now: string,
): SourceInput {
  return {
    channel: "manual",
    platform: "",
    metaLeadId: null,
    metaFormId: "",
    metaFormName: "",
    metaCampaignId: "",
    metaCampaignName: "",
    metaAdsetId: "",
    metaAdsetName: "",
    metaAdId: "",
    metaAdName: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmContent: "",
    utmTerm: "",
    submittedAt: now,
    ingestionOrigin: "manual",
    rawPayload: {
      derived_from_owner_lead_id: lead.id,
      derived_from_owner_lead_code: lead.code,
      original_form_name: original?.metaFormName ?? "",
      original_campaign_name: original?.metaCampaignName ?? "",
      original_meta_lead_id: original?.metaLeadId ?? "",
      note: "Staff added a client requirement from an owner lead. This is not a new Meta lead.",
    },
  };
}

async function loadByKeys(db: SqlDb, keys: string[]): Promise<Map<string, string>> {
  const placeholders = keys.map((_, index) => `?${index + 1}`).join(", ");
  const { results } = await db
    .prepare(`SELECT id, idempotency_key FROM demand_requirements WHERE idempotency_key IN (${placeholders})`)
    .bind(...keys)
    .all<{ id: string; idempotency_key: string }>();
  return new Map(results.map((row) => [row.idempotency_key, row.id]));
}

async function requirementsInOrder(db: SqlDb, keys: string[], found: Map<string, string>): Promise<Requirement[] | null> {
  if (found.size !== keys.length || keys.some((key) => !found.has(key))) return null;
  const requirements: Requirement[] = [];
  for (const key of keys) {
    const requirement = await getRequirement(db, found.get(key)!);
    if (!requirement) return null;
    requirements.push(requirement);
  }
  return requirements;
}

/**
 * Adds buyer and/or tenant requirements for the owner lead's existing contact.
 * One batch writes every source, requirement, role flag and audit row. A repeated
 * idempotency key, including two requests at the same time, returns the original
 * rows. The owner lead, its Meta source and its status are left as they are.
 */
export async function addClientRequirements(
  db: SqlDb,
  actor: AuditActor,
  ownerLeadId: string,
  input: { idempotencyKey: string; requirements: RequirementInput[] },
  now: string,
): Promise<ClientRequirementResult> {
  const idempotencyKey = text(input.idempotencyKey, 64);
  if (!KEY_PATTERN.test(idempotencyKey)) throw new HttpError(400, "Send a new submission key.");
  if (input.requirements.length < 1 || input.requirements.length > 2) {
    throw new HttpError(400, "Choose a buyer requirement, a tenant requirement, or both.");
  }
  const intents = input.requirements.map((item) => item.intent);
  if (new Set(intents).size !== intents.length) throw new HttpError(400, "Each requirement needs its own intent.");

  const lead = await getOwnerLead(db, ownerLeadId);
  if (!lead) throw new HttpError(404, "Owner lead not found.");
  const keys = input.requirements.map((item) => storageKey(idempotencyKey, item.intent));

  const replay = async (): Promise<ClientRequirementResult | null> => {
    const stored = await requirementsInOrder(db, keys, await loadByKeys(db, keys));
    return stored ? { requirements: stored, created: false } : null;
  };
  const already = await replay();
  if (already) return already;
  const partial = await loadByKeys(db, keys);
  if (partial.size > 0) throw new HttpError(409, "That submission did not finish. Start a new one.");

  const original = lead.sourceId ? await getSource(db, lead.sourceId) : null;
  const contact = { name: lead.contactName, phone: lead.contactPhone };
  const resolved = await resolveContact(db, actor, contact, "seeker", now);
  const statements: SqlStatement[] = [...resolved.statements];
  const codes: string[] = [];
  const ids: string[] = [];

  for (const requirement of input.requirements) {
    const source = insertSourceStatement(db, actor, manualSource(lead, original, now), now);
    const id = newId("req");
    const code = formatCode("GH-D", await nextSequence(db, "seq_requirement"));
    codes.push(code);
    ids.push(id);
    const columns = {
      id,
      code,
      contact_id: resolved.contactId,
      source_id: source.id,
      ...requirementColumns(requirement),
      status: "New",
      idempotency_key: storageKey(idempotencyKey, requirement.intent),
      origin_owner_lead_id: lead.id,
      created_at: now,
      created_by: actor.id,
      updated_at: now,
      updated_by: actor.id,
    } satisfies Record<string, SqlValue>;
    const names = Object.keys(columns) as (keyof typeof columns)[];
    statements.push(source.statement);
    statements.push(
      db
        .prepare(`INSERT INTO demand_requirements (${names.join(", ")}) VALUES (${names.map((_, index) => `?${index + 1}`).join(", ")})`)
        .bind(...names.map((name) => columns[name])),
    );
    statements.push(
      auditStatement(db, {
        actor,
        entityType: "requirement",
        entityId: id,
        entityLabel: `${code} ${lead.contactName}`,
        action: "create",
        changes: diffFields({}, requirementColumns(requirement)),
        context: { owner_lead_id: lead.id, idempotency_key: storageKey(idempotencyKey, requirement.intent), contact_id: resolved.contactId },
        at: now,
      }),
    );
  }

  statements.push(
    auditStatement(db, {
      actor,
      entityType: "owner_lead",
      entityId: lead.id,
      entityLabel: `${lead.code} ${lead.contactName}`,
      action: "add_client_requirement",
      context: { requirement_ids: ids.join(","), requirement_codes: codes.join(","), idempotency_key: idempotencyKey },
      at: now,
    }),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const winner = await replay();
    if (winner) return winner;
    throw new HttpError(409, "That submission was already saved. Refresh to see it.");
  }

  const created = await requirementsInOrder(db, keys, await loadByKeys(db, keys));
  if (!created) throw new HttpError(500, "The requirements were saved but could not be read back.");
  return { requirements: created, created: true };
}
