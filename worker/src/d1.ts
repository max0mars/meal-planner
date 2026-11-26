// The part of Cloudflare's D1 API that the data code uses. The real D1Database satisfies it, and so does the
// in-memory stand-in the app's tests use, so the same code runs in both places.

export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<{ meta: { changes?: number } }>
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement
  batch(statements: SqlStatement[]): Promise<unknown>
}
