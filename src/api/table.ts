// A table of the planner's data, with the same methods the app used from Dexie (toArray, where().equals(),
// add, put, update, delete, bulkAdd, and so on). Reads fetch the table once and filter it here; the data is small.
// Writes go to the Worker, then tell the live queries to run again.
import { TABLES } from '../../worker/src/tables'
import { ApiError, request } from './client'
import { notifyChange } from './liveQuery'

type Row = Record<string, unknown>

/** Rows sent in one bulk request, to stay well under D1's per-batch statement limit. */
const BULK_CHUNK = 200

const cache = new Map<string, Promise<Row[]>>()

function invalidate(name: string): void {
  cache.delete(name)
  notifyChange()
}

/** Forgets every cached table (after a restore, which changes them all at once). */
export function invalidateAll(): void {
  cache.clear()
  notifyChange()
}

/** The rows of a table as the server returns them. Cached until the next write to that table. */
function allRows(name: string): Promise<Row[]> {
  let rows = cache.get(name)
  if (!rows) {
    rows = request<Row[]>('GET', `/api/${name}`)
    cache.set(name, rows)
    // A failed read must not stay cached, or every later read fails too.
    rows.catch(() => cache.delete(name))
  }
  return rows.then((r) => structuredClone(r))
}

/** Undefined means "remove this field", which the server stores as null. */
function forServer(obj: Row): Row {
  const out: Row = {}
  for (const [key, value] of Object.entries(obj)) out[key] = value === undefined ? null : value
  return out
}

/** Every field of the table, empty ones as null, so a put replaces the whole row as Dexie did. */
function fullRow(name: string, obj: Row): Row {
  const def = TABLES[name]
  const out: Row = {}
  for (const field of def.fields) out[field.key] = obj[field.key] ?? null
  return out
}

function keyOf(name: string, row: Row): unknown {
  return row[TABLES[name].pk]
}

function keyPath(name: string, key: unknown): string {
  return `/api/${name}/${encodeURIComponent(String(key))}`
}

/** Whether a row matches `field equals value`. A list field (such as aliases) matches when it contains the value. */
function matches(row: Row, field: string, value: unknown): boolean {
  const actual = row[field]
  if (Array.isArray(actual) && !Array.isArray(value)) return actual.includes(value)
  return actual === value
}

export interface Collection<T> {
  toArray(): Promise<T[]>
  first(): Promise<T | undefined>
  count(): Promise<number>
  delete(): Promise<number>
  modify(change: ((row: T) => void) | Partial<T>): Promise<number>
  filter(test: (row: T) => boolean): Collection<T>
  reverse(): Collection<T>
}

export interface Where<T> {
  equals(value: unknown): Collection<T>
}

export interface Table<T> {
  readonly name: string
  toArray(): Promise<T[]>
  get(key: unknown): Promise<T | undefined>
  count(): Promise<number>
  add(obj: Partial<T>): Promise<number>
  put(obj: Partial<T>): Promise<number>
  update(key: unknown, changes: Partial<T>): Promise<number>
  delete(key: unknown): Promise<void>
  clear(): Promise<void>
  bulkAdd(rows: Partial<T>[]): Promise<void>
  bulkPut(rows: Partial<T>[]): Promise<void>
  bulkDelete(keys: unknown[]): Promise<void>
  where(field: keyof T & string): Where<T>
  orderBy(field: keyof T & string): Collection<T>
  filter(test: (row: T) => boolean): Collection<T>
}

function collection<T>(name: string, select: (rows: Row[]) => Row[]): Collection<T> {
  const load = async (): Promise<Row[]> => select(await allRows(name))
  return {
    async toArray() {
      return (await load()) as T[]
    },
    async first() {
      return (await load())[0] as T | undefined
    },
    async count() {
      return (await load()).length
    },
    async delete() {
      const rows = await load()
      for (const row of rows) await deleteRow(name, keyOf(name, row as Row))
      return rows.length
    },
    async modify(change) {
      const rows = await load()
      for (const row of rows) {
        const before = structuredClone(row)
        if (typeof change === 'function') change(row as T)
        else Object.assign(row, change)
        const diff: Row = {}
        for (const key of new Set([...Object.keys(before), ...Object.keys(row)])) {
          if (JSON.stringify(row[key]) !== JSON.stringify(before[key])) diff[key] = row[key]
        }
        if (Object.keys(diff).length > 0) await updateRow(name, keyOf(name, before), diff)
      }
      return rows.length
    },
    filter(test) {
      return collection<T>(name, (rows) => select(rows).filter((r) => test(r as T)))
    },
    reverse() {
      return collection<T>(name, (rows) => [...select(rows)].reverse())
    },
  }
}

async function deleteRow(name: string, key: unknown): Promise<void> {
  try {
    await request('DELETE', keyPath(name, key))
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e
  }
  invalidate(name)
}

/** Returns 1 if the row existed and was changed, 0 if there was no such row. */
async function updateRow(name: string, key: unknown, changes: Row): Promise<number> {
  try {
    await request('PUT', keyPath(name, key), forServer(changes))
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return 0
    throw e
  }
  invalidate(name)
  return 1
}

export function createTable<T>(name: string): Table<T> {
  const def = TABLES[name]
  if (!def) throw new Error(`No table called "${name}"`)

  const table: Table<T> = {
    name,
    toArray: async () => (await allRows(name)) as T[],

    async get(key) {
      try {
        return await request<T>('GET', keyPath(name, key))
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return undefined
        throw e
      }
    },

    async count() {
      return (await allRows(name)).length
    },

    async add(obj) {
      const created = await request<Row>('POST', `/api/${name}`, forServer(obj as Row))
      invalidate(name)
      return keyOf(name, created) as number
    },

    async put(obj) {
      const row = obj as Row
      const key = row[def.pk]
      const full = fullRow(name, row)
      if (def.pkKind === 'auto' && key === undefined) {
        const created = await request<Row>('POST', `/api/${name}`, forServer(full))
        invalidate(name)
        return keyOf(name, created) as number
      }
      if (def.pkKind === 'auto') {
        // Replace the row with this id, or add it with this id if it isn't there yet.
        try {
          await request('PUT', keyPath(name, key), forServer(full))
        } catch (e) {
          if (!(e instanceof ApiError && e.status === 404)) throw e
          await request('POST', `/api/${name}`, forServer({ ...full, [def.pk]: key }))
        }
        invalidate(name)
        return key as number
      }
      // Text-keyed and settings rows: the PUT creates or replaces the row named in the URL.
      await request('PUT', keyPath(name, key ?? 1), forServer(full))
      invalidate(name)
      return (key ?? 1) as number
    },

    async update(key, changes) {
      // Like Dexie's update: changes a row that exists, and does nothing (returns 0) when there is none.
      if (def.pkKind !== 'auto' && (await table.get(key)) === undefined) return 0
      return updateRow(name, key, changes as Row)
    },

    delete: (key) => deleteRow(name, key),

    async clear() {
      await request('DELETE', `/api/${name}?all=1`)
      invalidate(name)
    },

    async bulkAdd(rows) {
      if (def.pkKind === 'fixed') {
        // Settings is one row at a fixed address, so each row is saved there rather than added in bulk.
        for (const row of rows) await table.put(row)
        invalidate(name)
        return
      }
      for (let i = 0; i < rows.length; i += BULK_CHUNK) {
        const chunk = rows.slice(i, i + BULK_CHUNK).map((r) => forServer(r as Row))
        await request('POST', `/api/${name}/bulk`, chunk)
      }
      invalidate(name)
    },

    async bulkPut(rows) {
      for (const row of rows) await table.put(row)
    },

    async bulkDelete(keys) {
      for (const key of keys) await deleteRow(name, key)
    },

    where(field) {
      return {
        equals: (value) => collection<T>(name, (rows) => rows.filter((r) => matches(r, field, value))),
      }
    },

    orderBy(field) {
      return collection<T>(name, (rows) => [...rows].sort((a, b) => compare(a[field], b[field])))
    },

    filter(test) {
      return collection<T>(name, (rows) => rows.filter((r) => test(r as T)))
    },
  }
  return table
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === undefined || a === null) return -1
  if (b === undefined || b === null) return 1
  return a < b ? -1 : a > b ? 1 : 0
}
