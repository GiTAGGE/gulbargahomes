import { auditStatement, diffFields, type AuditActor, type AuditEntity } from "../admin/audit";
import { HttpError } from "../admin/errors";
import { changedRows, type SqlDb, type SqlStatement, type SqlValue } from "../db/sql";

/**
 * Optimistically-locked update of one row plus its audit entry, in one batch.
 * Only columns whose values differ from `before` are written.
 */
export async function updateVersionedRecord(
  db: SqlDb,
  actor: AuditActor,
  options: {
    table: "owner_leads" | "demand_requirements";
    entityType: AuditEntity;
    id: string;
    label: string;
    rowVersion: number;
    before: Record<string, unknown>;
    next: Record<string, SqlValue>;
    action?: string;
    now: string;
    extra?: SqlStatement[];
  },
): Promise<boolean> {
  const changes = diffFields(options.before, options.next);
  const names = Object.keys(options.next).filter((name) => name in changes);
  if (names.length === 0) return false;

  const results = await db.batch([
    db
      .prepare(
        `UPDATE ${options.table} SET ${names.map((name, index) => `${name} = ?${index + 1}`).join(", ")},
           updated_at = ?${names.length + 1}, updated_by = ?${names.length + 2}, row_version = row_version + 1
         WHERE id = ?${names.length + 3} AND row_version = ?${names.length + 4}`,
      )
      .bind(...names.map((name) => options.next[name]), options.now, actor.id, options.id, options.rowVersion),
    auditStatement(db, {
      actor,
      entityType: options.entityType,
      entityId: options.id,
      entityLabel: options.label,
      action: options.action ?? ("status" in changes ? "status_change" : "update"),
      changes,
      at: options.now,
      onlyIfPreviousChanged: true,
    }),
    ...(options.extra ?? []),
  ]);
  if (changedRows(results[0]) === 0) {
    throw new HttpError(409, "Someone else changed this record. Reload to see the latest version.");
  }
  return true;
}
