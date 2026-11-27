// Test setup: stands in for the Worker. The app's requests go to the real Worker code (worker/src/data.ts),
// which runs against an in-memory SQLite database with the same schema as D1. Import this first in any test that
// touches the planner's data; it replaces the browser database that used to be faked with fake-indexeddb.
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { handleCommit, handleData, handleRestore } from '../../worker/src/data'
import type { SqlDatabase, SqlStatement } from '../../worker/src/d1'
import { TEST_TOKEN } from './token'

// Vitest runs from the project root.
const migrationsDir = resolve(process.cwd(), 'worker/migrations')

function openDatabase(): SqlDatabase {
  const sqlite = new DatabaseSync(':memory:')
  for (const file of readdirSync(migrationsDir).sort()) sqlite.exec(readFileSync(`${migrationsDir}/${file}`, 'utf8'))

  const statement = (sql: string): SqlStatement => {
    const prepared = sqlite.prepare(sql)
    let params: unknown[] = []
    const s: SqlStatement = {
      bind(...values: unknown[]) {
        params = values
        return s
      },
      async all<T>() {
        return { results: prepared.all(...(params as never[])) as T[] }
      },
      async first<T>() {
        return (prepared.get(...(params as never[])) ?? null) as T | null
      },
      async run() {
        const result = prepared.run(...(params as never[]))
        return { meta: { changes: Number(result.changes) } }
      },
    }
    return s
  }

  return {
    prepare: statement,
    async batch(statements: SqlStatement[]) {
      // One batch is one transaction, as on D1.
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const s of statements) results.push(await s.all())
        sqlite.exec('COMMIT')
        return results
      } catch (e) {
        sqlite.exec('ROLLBACK')
        throw e
      }
    },
  }
}

const database = openDatabase()

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  if (request.headers.get('Authorization') !== `Bearer ${TEST_TOKEN}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } })
  }
  const segments = new URL(request.url).pathname.split('/').filter(Boolean)
  if (segments.length === 2 && segments[1] === 'restore') return handleRestore(request, database)
  if (segments.length === 2 && segments[1] === 'commit') return handleCommit(request, database)
  return handleData(request, database, segments)
}) as typeof fetch

// Node tests have no localStorage; give them a small one so the client can read the token.
if (typeof localStorage === 'undefined') {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
    },
  })
}
localStorage.setItem('mealPlanner.apiToken', TEST_TOKEN)
