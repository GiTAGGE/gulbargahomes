import { DatabaseSync } from "node:sqlite";

import type { SqlDb, SqlStatement, SqlValue } from "../../lib/db/sql";

/** node:sqlite behind the same interface as the D1 binding, including atomic batch. */
export function createTestDb(): SqlDb & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");

  function statement(sql: string, values: SqlValue[] = []): SqlStatement & { exec(): unknown } {
    return {
      bind: (...next: SqlValue[]) => statement(sql, next),
      async all<T>() {
        return { results: raw.prepare(sql).all(...values) as T[] };
      },
      async first<T>() {
        return (raw.prepare(sql).get(...values) as T | undefined) ?? null;
      },
      async run() {
        return this.exec();
      },
      exec() {
        const result = raw.prepare(sql).run(...values);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }

  return {
    raw,
    prepare: (sql: string) => statement(sql),
    async batch(statements: SqlStatement[]) {
      raw.exec("BEGIN");
      try {
        const results = statements.map((item) => (item as ReturnType<typeof statement>).exec());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
