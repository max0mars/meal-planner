import { handleData } from './data'

export interface Env {
  DB: D1Database
  /** Set with `wrangler secret put API_TOKEN`. Every request must send it as `Authorization: Bearer <token>`. */
  API_TOKEN: string
}

/** Compares two strings in the same time whatever they contain, so the token can't be guessed a character at a time. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  const len = Math.max(x.length, y.length)
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

export function isAuthorized(request: Request, expected: string | undefined): boolean {
  if (!expected) return false
  const header = request.headers.get('Authorization') ?? ''
  const match = /^Bearer (.+)$/.exec(header)
  return match !== null && safeEqual(match[1], expected)
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!isAuthorized(request, env.API_TOKEN)) return json({ error: 'Unauthorized' }, 401)

    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments[0] !== 'api') return json({ error: 'Not found' }, 404)

    if (request.method === 'GET' && segments.length === 2 && segments[1] === 'health') {
      // Checks the database is reachable as well as the Worker itself.
      const row = await env.DB.prepare('SELECT COUNT(*) AS settings FROM settings').first<{ settings: number }>()
      return json({ ok: true, settingsRows: row?.settings ?? 0 })
    }

    return handleData(request, env.DB, segments)
  },
} satisfies ExportedHandler<Env>
