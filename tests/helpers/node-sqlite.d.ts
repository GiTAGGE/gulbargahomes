declare module "node:sqlite" {
  type Value = string | number | bigint | null | Uint8Array;

  export class StatementSync {
    all(...values: Value[]): unknown[];
    get(...values: Value[]): unknown;
    run(...values: Value[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }

  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }
}
