// A table of the planner's data, with the same methods the app used from Dexie (toArray, where().equals(),
// add, put, update, delete, bulkAdd, and so on). Reads fetch the table once and filter it here; the data is small.
//
// Outside a transaction, each write is sent to the Worker on its own. Inside a transaction (see runTransaction), reads
// and writes work on a copy of each table; when the transaction ends, only the differences are sent, in one batch, so
// they all land or none do.
import { TABLES } from '../../worker/src/tables'
import { ApiError, request } from './client'
import { notifyChange } from './liveQuery'

type Row = Record<string, unknown>

/** Rows sent in one bulk request, to stay well under D1's per-batch statement limit. */
const BULK_CHUNK = 200

// ---------- reads outside transactions

const cache = new Map<string, Promise<Row[]>>()

function invalidate(name: string): void {
  cache.delete(name)
  notifyChange()
}

/** Forgets every cached table (after a restore or a transaction, which can change them all). */
export function invalidateAll(): void {
  cache.clear()
  notifyChange()
}

// ---------- transactions

interface TableCopy {
  /** The rows as the server had them when the transaction began, by key. */
  original: Map<string, Row>
  /** The rows as the transaction leaves them, by key. */
  current: Map<string, Row>
  cleared: boolean
}

interface Transaction {
  tables: Map<string, Promise<TableCopy>>
  nextTempKey: number
}

let activeTransaction: Transaction | null = null

/** Transactions run one after another, so two quick taps cannot both read the same value and both write. */
let transactionQueue: Promise<unknown> = Promise.resolve()

const keyText = (key: unknown) => String(key)

/** Keys of new rows made inside a transaction are negative until the server gives them their real ids. */
function tempKey(txn: Transaction): number {
  return txn.nextTempKey--
}

function copyOf(name: string): Promise<TableCopy> {
  const txn = activeTransaction!
  let copy = txn.tables.get(name)
  if (!copy) {
    copy = request<Row[]>('GET', `/api/${name}`).then((rows) => {
      const key = TABLES[name].pk
      const original = new Map(rows.map((r) => [keyText(r[key]), r]))
      const current = new Map([...original].map(([k, r]) => [k, structuredClone(r)]))
      return { original, current, cleared: false }
    })
    txn.tables.set(name, copy)
  }
  return copy
}

/** Drops empty fields, as the server does: a field with no value is absent. */
function withoutEmpty(obj: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v
  return out
}

/** The change one table needs, as the Worker's commit endpoint reads it. */
function tableChanges(name: string, copy: TableCopy): { spec: Record<string, unknown>; inserted: unknown[] } {
  const def = TABLES[name]
  const deletes: unknown[] = []
  const updates: { key: unknown; changes: Row }[] = []
  const inserts: Row[] = []
  const inserted: unknown[] = []

  const newRow = (key: unknown, row: Row): Row => {
    const out: Row = { ...row }
    // A new row with a temporary key gets its id from the database; one with a real id keeps it.
    if (def.pkKind === 'auto' && typeof key === 'number' && key < 0) delete out[def.pk]
    else out[def.pk] = key
    return out
  }

  if (copy.cleared) {
    for (const row of copy.current.values()) {
      inserts.push(newRow(row[def.pk], row))
      inserted.push(row[def.pk])
    }
    return { spec: { clear: true, inserts }, inserted }
  }

  for (const [k, original] of copy.original) {
    if (!copy.current.has(k)) deletes.push(original[def.pk])
  }
  for (const [k, row] of copy.current) {
    const before = copy.original.get(k)
    if (!before) {
      inserts.push(newRow(row[def.pk], row))
      inserted.push(row[def.pk])
      continue
    }
    const changes: Row = {}
    for (const field of new Set([...Object.keys(before), ...Object.keys(row)])) {
      if (field === def.pk) continue
      if (JSON.stringify(row[field]) !== JSON.stringify(before[field])) changes[field] = row[field] ?? null
    }
    if (Object.keys(changes).length > 0) updates.push({ key: before[def.pk], changes })
  }
  const spec: Record<string, unknown> = {}
  if (deletes.length) spec.deletes = deletes
  if (updates.length) spec.updates = updates
  if (inserts.length) spec.inserts = inserts
  return { spec, inserted }
}

/** Sends a transaction's changes to the Worker as one batch. Returns the real id of each new row, by its temporary key. */
async function commit(txn: Transaction): Promise<Map<number, number>> {
  const tables: Record<string, Record<string, unknown>> = {}
  const insertedKeys: { table: string; key: unknown }[] = []
  for (const [name, copyPromise] of txn.tables) {
    const { spec, inserted } = tableChanges(name, await copyPromise)
    if (Object.keys(spec).length === 0) continue
    tables[name] = spec
    for (const key of inserted) insertedKeys.push({ table: name, key })
  }
  const realIds = new Map<number, number>()
  if (Object.keys(tables).length === 0) return realIds

  // A new row cannot be used by another row before it has its real id, so refuse that.
  const temps = new Set(insertedKeys.filter((p) => typeof p.key === 'number' && p.key < 0).map((p) => p.key as number))
  for (const spec of Object.values(tables)) {
    const rows: Row[] = [...((spec.inserts as Row[] | undefined) ?? []), ...((spec.updates as { changes: Row }[] | undefined) ?? []).map((u) => u.changes)]
    for (const row of rows) {
      if (Object.values(row).some((v) => typeof v === 'number' && temps.has(v))) throw new Error('A new item was used by another item in the same change.')
    }
  }

  const response = await request<{ ids: Record<string, unknown[]> }>('POST', '/api/commit', { tables })
  // The server answers with the ids of each table's inserts, in the order they were sent.
  const next: Record<string, number> = {}
  for (const item of insertedKeys) {
    const position = next[item.table] ?? 0
    next[item.table] = position + 1
    const id = response.ids[item.table]?.[position]
    if (typeof item.key === 'number' && item.key < 0 && typeof id === 'number') realIds.set(item.key, id)
  }
  return realIds
}

/**
 * Runs `work` as one transaction: everything it reads and writes through the planner's tables is applied together, or
 * not at all. Nested calls join the transaction they are inside. Returns what `work` returns, with new rows' ids real.
 */
export function runTransaction<T>(work: () => Promise<T>): Promise<T> {
  if (activeTransaction) return work()
  const run = transactionQueue.then(async () => {
    const txn: Transaction = { tables: new Map(), nextTempKey: -1 }
    activeTransaction = txn
    let result: T
    let realIds: Map<number, number>
    try {
      result = await work()
      realIds = await commit(txn)
    } finally {
      activeTransaction = null
    }
    invalidateAll()
    if (typeof result === 'number' && realIds.has(result)) return realIds.get(result) as T
    return result
  })
  transactionQueue = run.catch(() => undefined)
  return run
}

// ---------- shared helpers

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

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === undefined || a === null) return -1
  if (b === undefined || b === null) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** The rows of a table in key order. Outside a transaction they are cached until the next write to that table. */
function allRows(name: string): Promise<Row[]> {
  if (activeTransaction) {
    const key = TABLES[name].pk
    return copyOf(name).then((copy) => [...copy.current.values()].map((r) => structuredClone(r)).sort((a, b) => compare(a[key], b[key])))
  }
  let rows = cache.get(name)
  if (!rows) {
    rows = request<Row[]>('GET', `/api/${name}`)
    cache.set(name, rows)
    // A failed read must not stay cached, or every later read fails too.
    rows.catch(() => cache.delete(name))
  }
  return rows.then((r) => structuredClone(r))
}

/** Whether a row matches `field equals value`. A list field (such as aliases) matches when it contains the value. */
function matches(row: Row, field: string, value: unknown): boolean {
  const actual = row[field]
  if (Array.isArray(actual) && !Array.isArray(value)) return actual.includes(value)
  return actual === value
}

// ---------- writes (inside a transaction they change the copy; outside, they go straight to the Worker)

async function deleteRow(name: string, key: unknown): Promise<void> {
  if (activeTransaction) {
    ;(await copyOf(name)).current.delete(keyText(key))
    return
  }
  try {
    await request('DELETE', keyPath(name, key))
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e
  }
  invalidate(name)
}

/** Returns 1 if the row existed and was changed, 0 if there was no such row. */
async function updateRow(name: string, key: unknown, changes: Row): Promise<number> {
  if (activeTransaction) {
    const row = (await copyOf(name)).current.get(keyText(key))
    if (!row) return 0
    for (const [field, value] of Object.entries(changes)) {
      if (value === undefined || value === null) delete row[field]
      else row[field] = value
    }
    return 1
  }
  try {
    await request('PUT', keyPath(name, key), forServer(changes))
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return 0
    throw e
  }
  invalidate(name)
  return 1
}

// ---------- the table

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
      for (const row of rows) await deleteRow(name, keyOf(name, row))
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

export function createTable<T>(name: string): Table<T> {
  const def = TABLES[name]
  if (!def) throw new Error(`No table called "${name}"`)

  const table: Table<T> = {
    name,
    toArray: async () => (await allRows(name)) as T[],

    async get(key) {
      if (activeTransaction) {
        const row = (await copyOf(name)).current.get(keyText(key))
        return row ? (structuredClone(row) as T) : undefined
      }
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
      const row = obj as Row
      if (activeTransaction) {
        const copy = await copyOf(name)
        const key = row[def.pk] ?? tempKey(activeTransaction)
        copy.current.set(keyText(key), { ...withoutEmpty(row), [def.pk]: key })
        return key as number
      }
      const created = await request<Row>('POST', `/api/${name}`, forServer(obj as Row))
      invalidate(name)
      return keyOf(name, created) as number
    },

    async put(obj) {
      const row = obj as Row
      const key = row[def.pk]
      if (activeTransaction) {
        const copy = await copyOf(name)
        const storedKey = key ?? (def.pkKind === 'fixed' ? 1 : tempKey(activeTransaction))
        copy.current.set(keyText(storedKey), { ...withoutEmpty(fullRow(name, row)), [def.pk]: storedKey })
        return storedKey as number
      }
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

    async delete(key) {
      await deleteRow(name, key)
    },

    async clear() {
      if (activeTransaction) {
        const copy = await copyOf(name)
        copy.current.clear()
        copy.cleared = true
        return
      }
      await request('DELETE', `/api/${name}?all=1`)
      invalidate(name)
    },

    async bulkAdd(rows) {
      if (activeTransaction || def.pkKind === 'fixed') {
        for (const row of rows) await table.put(row)
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
