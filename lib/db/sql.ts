export type SqlValue = string | number | null;

export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

/** The subset of the D1 binding the app uses. `batch` runs as one transaction. */
export interface SqlDb {
  prepare(query: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<unknown[]>;
}

/** Rows changed by a `run()` result from D1 (`meta.changes`) or node:sqlite (`changes`). */
export function changedRows(result: unknown): number {
  if (!result || typeof result !== "object") return 0;
  const record = result as { changes?: unknown; meta?: { changes?: unknown } };
  const value = record.meta?.changes ?? record.changes;
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string" || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Atomically advance a named counter in app_meta and return the new value. */
export async function nextSequence(db: SqlDb, key: string): Promise<number> {
  await db
    .prepare("INSERT INTO app_meta (key, value) VALUES (?1, '0') ON CONFLICT(key) DO NOTHING")
    .bind(key)
    .run();
  const row = await db
    .prepare(
      "UPDATE app_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = ?1 RETURNING value",
    )
    .bind(key)
    .first<{ value: string }>();
  return Number(row?.value ?? 0);
}

export function formatCode(prefix: string, sequence: number): string {
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}
