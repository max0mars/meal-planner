import { RowError, fromSql, toSql, type AppRow, type SqlRow } from './rows'
import type { SqlDatabase } from './d1'
import { TABLES, type TableDef } from './tables'

/** Responses that can be shown to the app: a status and a JSON body. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function errorResponse(status: number, message: string): Response {
  return json({ error: message }, status)
}

/** Turns a database error into a plain message. Constraint failures (a value the schema refuses) are the caller's fault, so they get a 400. */
function dbError(e: unknown): Response {
  const message = e instanceof Error ? e.message : String(e)
  if (/CHECK|UNIQUE|NOT NULL|FOREIGN KEY|constraint/i.test(message)) return errorResponse(400, `The database refused that change: ${message}`)
  return errorResponse(500, `Database error: ${message}`)
}

/** The key from the URL, checked against the table's key type. Returns null if it cannot be a key for this table. */
function parseKey(def: TableDef, raw: string): string | number | null {
  if (def.pkKind === 'auto') return /^\d+$/.test(raw) ? Number(raw) : null
  if (def.pkKind === 'fixed') return raw === '1' ? 1 : null
  return raw.length > 0 ? raw : null
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    throw new RowError('The request body must be JSON')
  }
}

function asObject(body: unknown): AppRow {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new RowError('The request body must be a JSON object')
  return body as AppRow
}

/** Builds `(cols) VALUES (?...)` pieces for an insert or upsert. */
function columnsAndValues(cols: Record<string, unknown>): { names: string[]; values: unknown[]; marks: string } {
  const names = Object.keys(cols)
  return { names, values: names.map((n) => cols[n]), marks: names.map(() => '?').join(', ') }
}

export async function handleData(request: Request, db: SqlDatabase, segments: string[]): Promise<Response> {
  // segments: ['api', table] or ['api', table, key] or ['api', table, 'bulk']
  const def = TABLES[segments[1]]
  if (!def) return errorResponse(404, `No table called "${segments[1]}"`)
  const url = new URL(request.url)
  const method = request.method

  try {
    // Collection: /api/<table>
    if (segments.length === 2) {
      if (method === 'GET') {
        const rows = await db.prepare(`SELECT * FROM ${def.sql} ORDER BY ${def.pk}`).all<SqlRow>()
        return json(rows.results.map((r) => fromSql(def, r)))
      }
      if (method === 'POST') {
        if (def.pkKind === 'fixed') return errorResponse(400, 'Settings is one row: use PUT /api/settings/1')
        const cols = toSql(def, asObject(await readBody(request)), { allowId: true })
        const insert = Object.keys(cols).length
          ? (() => {
              const { names, values, marks } = columnsAndValues(cols)
              return db.prepare(`INSERT INTO ${def.sql} (${names.join(', ')}) VALUES (${marks}) RETURNING *`).bind(...values)
            })()
          : db.prepare(`INSERT INTO ${def.sql} DEFAULT VALUES RETURNING *`)
        const row = await insert.first<SqlRow>()
        return row ? json(fromSql(def, row), 201) : errorResponse(500, 'The insert returned nothing')
      }
      if (method === 'DELETE') {
        if (url.searchParams.get('all') !== '1') return errorResponse(400, 'To delete every row, send DELETE with ?all=1')
        const result = await db.prepare(`DELETE FROM ${def.sql}`).run()
        return json({ deleted: result.meta.changes ?? 0 })
      }
      return errorResponse(405, 'Method not allowed')
    }

    // Bulk insert: POST /api/<table>/bulk with an array of rows (ids are kept, for restoring a backup)
    if (segments.length === 3 && segments[2] === 'bulk') {
      if (method !== 'POST') return errorResponse(405, 'Method not allowed')
      if (def.pkKind === 'fixed') return errorResponse(400, 'Settings is one row: use PUT /api/settings/1')
      const body = await readBody(request)
      if (!Array.isArray(body)) throw new RowError('The bulk body must be a JSON array of objects')
      const statements = body.map((item) => {
        const cols = toSql(def, asObject(item), { allowId: true })
        const { names, values, marks } = columnsAndValues(cols)
        return db.prepare(`INSERT INTO ${def.sql} (${names.join(', ')}) VALUES (${marks})`).bind(...values)
      })
      // One batch is one transaction: all rows are written or none are.
      if (statements.length > 0) await db.batch(statements)
      return json({ inserted: statements.length }, 201)
    }

    // One row: /api/<table>/<key>
    if (segments.length === 3) {
      const key = parseKey(def, decodeURIComponent(segments[2]))
      if (key === null) return errorResponse(404, `No such ${segments[1]} row`)

      if (method === 'GET') {
        const row = await db.prepare(`SELECT * FROM ${def.sql} WHERE ${def.pk} = ?`).bind(key).first<SqlRow>()
        return row ? json(fromSql(def, row)) : errorResponse(404, `No such ${segments[1]} row`)
      }

      if (method === 'PUT') {
        const body = asObject(await readBody(request))
        if (def.pkKind === 'auto') {
          // Update an existing row; the id comes from the URL.
          const cols = toSql(def, body, { allowId: false })
          if (Object.keys(cols).length === 0) {
            const row = await db.prepare(`SELECT * FROM ${def.sql} WHERE ${def.pk} = ?`).bind(key).first<SqlRow>()
            return row ? json(fromSql(def, row)) : errorResponse(404, `No such ${segments[1]} row`)
          }
          const names = Object.keys(cols)
          const sets = names.map((n) => `${n} = ?`).join(', ')
          const row = await db
            .prepare(`UPDATE ${def.sql} SET ${sets} WHERE ${def.pk} = ? RETURNING *`)
            .bind(...names.map((n) => cols[n]), key)
            .first<SqlRow>()
          return row ? json(fromSql(def, row)) : errorResponse(404, `No such ${segments[1]} row`)
        }

        // Text-keyed and settings rows: change the row named in the URL, or create it if it is not there.
        // Update first: an INSERT ... ON CONFLICT checks the required columns on the new row before it finds the
        // existing one, so a partial change to an existing settings row would fail that check.
        const cols = toSql(def, body, { allowId: false })
        const changed = Object.keys(cols)
        if (changed.length > 0) {
          const sets = changed.map((n) => `${n} = ?`).join(', ')
          const updated = await db
            .prepare(`UPDATE ${def.sql} SET ${sets} WHERE ${def.pk} = ? RETURNING *`)
            .bind(...changed.map((n) => cols[n]), key)
            .first<SqlRow>()
          if (updated) return json(fromSql(def, updated))
        } else {
          const existing = await db.prepare(`SELECT * FROM ${def.sql} WHERE ${def.pk} = ?`).bind(key).first<SqlRow>()
          if (existing) return json(fromSql(def, existing))
        }
        cols[def.pk] = key
        const { names, values, marks } = columnsAndValues(cols)
        const created = await db.prepare(`INSERT INTO ${def.sql} (${names.join(', ')}) VALUES (${marks}) RETURNING *`).bind(...values).first<SqlRow>()
        return created ? json(fromSql(def, created)) : errorResponse(500, 'The save returned nothing')
      }

      if (method === 'DELETE') {
        const result = await db.prepare(`DELETE FROM ${def.sql} WHERE ${def.pk} = ?`).bind(key).run()
        if ((result.meta.changes ?? 0) === 0) return errorResponse(404, `No such ${segments[1]} row`)
        return json({ deleted: result.meta.changes })
      }

      return errorResponse(405, 'Method not allowed')
    }

    return errorResponse(404, 'Not found')
  } catch (e) {
    if (e instanceof RowError) return errorResponse(400, e.message)
    return dbError(e)
  }
}

/**
 * Replaces every table with the rows of a backup, in one batch. D1 runs a batch as one transaction, so if any row
 * is refused nothing changes. Body: { tables: { <table name>: row[] } }, as written by the app's backup file.
 */
export async function handleRestore(request: Request, db: SqlDatabase): Promise<Response> {
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed')
  try {
    const body = asObject(await readBody(request))
    const tables = body.tables
    if (typeof tables !== 'object' || tables === null || Array.isArray(tables)) throw new RowError('The backup has no tables')
    const statements: ReturnType<SqlDatabase['prepare']>[] = []
    const counts: Record<string, number> = {}

    // Check every table before writing anything.
    for (const name of Object.keys(tables)) {
      if (!TABLES[name]) throw new RowError(`The backup has an unknown table "${name}"`)
    }
    for (const [name, def] of Object.entries(TABLES)) {
      const rows = (tables as Record<string, unknown>)[name]
      if (rows === undefined) continue
      if (!Array.isArray(rows)) throw new RowError(`The backup's "${name}" is not a list`)
      const seen = new Set<unknown>()
      counts[name] = rows.length
      statements.push(db.prepare(`DELETE FROM ${def.sql}`))
      for (const item of rows) {
        const cols = toSql(def, asObject(item), { allowId: true })
        if (def.pkKind === 'fixed') cols[def.pk] = 1
        const pk = cols[def.pk]
        if (pk !== undefined) {
          if (seen.has(pk)) throw new RowError(`The backup has "${name}" ${def.pk} ${String(pk)} twice`)
          seen.add(pk)
        }
        const { names, values, marks } = columnsAndValues(cols)
        statements.push(db.prepare(`INSERT INTO ${def.sql} (${names.join(', ')}) VALUES (${marks})`).bind(...values))
      }
    }
    if (statements.length > 0) await db.batch(statements)
    return json({ restored: counts })
  } catch (e) {
    if (e instanceof RowError) return errorResponse(400, e.message)
    return dbError(e)
  }
}
