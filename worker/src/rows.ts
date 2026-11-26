import type { Field, TableDef } from './tables'

export type AppRow = Record<string, unknown>
export type SqlRow = Record<string, unknown>

/** A value the app sent that does not fit its field. Reported to the caller as a 400. */
export class RowError extends Error {}

function checkValue(field: Field, value: unknown): void {
  if (value === null || value === undefined) return
  switch (field.kind) {
    case 'text':
      if (typeof value !== 'string') throw new RowError(`${field.key} must be text`)
      return
    case 'num':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new RowError(`${field.key} must be a number`)
      return
    case 'bool':
      if (typeof value !== 'boolean') throw new RowError(`${field.key} must be true or false`)
      return
    case 'json':
      return
  }
}

/**
 * Converts an app object to SQL columns. Only the keys given are returned, so an update touches only those.
 * `allowId` is false for updates, where the id comes from the URL.
 */
export function toSql(def: TableDef, obj: AppRow, opts: { allowId: boolean }): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const byKey = new Map(def.fields.map((fl) => [fl.key, fl]))
  for (const [key, value] of Object.entries(obj)) {
    if (key === def.pk) {
      if (!opts.allowId || value === undefined) continue
      if (def.pkKind === 'auto') {
        if (typeof value !== 'number' || !Number.isInteger(value)) throw new RowError(`${key} must be a whole number`)
      } else if (def.pkKind === 'text') {
        if (typeof value !== 'string') throw new RowError(`${key} must be text`)
      } else {
        continue // settings is always id 1; it is never written from the body
      }
      out[def.pk] = value
      continue
    }
    const field = byKey.get(key)
    if (!field) throw new RowError(`Unknown field "${key}"`)
    checkValue(field, value)
    if (value === undefined) continue
    if (value === null) out[field.col] = null
    else if (field.kind === 'bool') out[field.col] = value ? 1 : 0
    else if (field.kind === 'json') out[field.col] = JSON.stringify(value)
    else out[field.col] = value
  }
  return out
}

/** Converts a SQL row to the app's shape. Empty fields are left out, as Dexie did when a value was never set. */
export function fromSql(def: TableDef, row: SqlRow): AppRow {
  const out: AppRow = {}
  out[def.pk] = def.pkKind === 'fixed' ? 1 : row[def.pk]
  for (const field of def.fields) {
    const raw = row[field.col]
    if (raw === null || raw === undefined) continue
    if (field.kind === 'bool') out[field.key] = raw === 1
    else if (field.kind === 'json') out[field.key] = JSON.parse(String(raw))
    else out[field.key] = raw
  }
  return out
}
