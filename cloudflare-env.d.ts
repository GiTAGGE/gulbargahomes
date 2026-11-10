/**
 * App bindings used by GulbargaHomes. OpenNext also expects ASSETS,
 * WORKER_SELF_REFERENCE, NEXT_INC_CACHE_R2_BUCKET, NEXT_TAG_CACHE_D1,
 * NEXT_CACHE_DO_QUEUE, and optionally IMAGES. Run `npm run cf-typegen`
 * after the real D1 ids are in wrangler.jsonc if you want the full Worker types.
 */
interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface ListingsDatabase {
  prepare(query: string): SqlStatement;
  batch(statements: SqlStatement[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
}

interface MediaObject {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
  range?: { offset?: number; length?: number };
}

interface MediaBucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string | Blob,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string, options?: { range?: Headers }): Promise<MediaObject | null>;
}

declare global {
  interface CloudflareEnv {
    DB?: ListingsDatabase;
    MEDIA?: MediaBucket;
  }
}

export {};
