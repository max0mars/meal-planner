// One-time, polite fetch of the servings and total time published by each starter recipe's source page.
// Usage: npx tsx scripts/fetch-yields.ts <folder-for-raw-results>
//
// - Checks each site's robots.txt and skips anything it disallows.
// - About one request per second, with a User-Agent that says what this is.
// - A site that blocks the request is skipped, not worked around.
// - Keeps only numbers (servings, minutes) in scripts/data/source-yields.json. No recipe text is stored.
// - Page contents are untrusted data: they are only ever parsed as JSON, never executed.
// The published calories and protein are written to the raw-results folder only, to measure how close this app's
// own calculations are. They are not stored in the app.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2]
if (!outDir) {
  console.error('Usage: npx tsx scripts/fetch-yields.ts <folder-for-raw-results>')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const UA = 'meal-planner-personal-script (one-time fetch of recipe servings for a personal app)'
const recipes = JSON.parse(readFileSync(join(here, '..', 'src', 'data', 'recipes.seed.json'), 'utf8')) as {
  seedId: string
  title: string
  source: string
}[]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- robots.txt (the "*" group; longest matching rule wins, Allow wins a tie) ----
type Rule = { allow: boolean; pattern: string }
const robotsCache = new Map<string, Rule[] | 'unreachable'>()

async function rulesFor(origin: string): Promise<Rule[] | 'unreachable'> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!
  let rules: Rule[] | 'unreachable' = []
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
    if (res.ok) {
      let inStar = false
      let sawAgent = false
      for (const raw of (await res.text()).split(/\r?\n/)) {
        const line = raw.replace(/#.*/, '').trim()
        const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
        if (!m) continue
        const key = m[1].toLowerCase()
        if (key === 'user-agent') {
          if (sawAgent && !inStar) inStar = false
          inStar = m[2].trim() === '*' || (sawAgent && inStar)
          sawAgent = true
        } else if (inStar && (key === 'allow' || key === 'disallow') && m[2].trim()) {
          rules.push({ allow: key === 'allow', pattern: m[2].trim() })
        } else if (key !== 'allow' && key !== 'disallow') {
          sawAgent = false
        }
      }
    } else if (res.status >= 500) rules = 'unreachable'
  } catch {
    rules = 'unreachable'
  }
  robotsCache.set(origin, rules)
  return rules
}

function matches(pattern: string, path: string): boolean {
  const re = new RegExp('^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'))
  return re.test(path)
}

function allowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null
  for (const r of rules) {
    if (!matches(r.pattern, path)) continue
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r
  }
  return best ? best.allow : true
}

// ---- parsing ----
function findRecipe(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n)
      if (r) return r
    }
    return null
  }
  const obj = node as Record<string, unknown>
  const type = obj['@type']
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) return obj
  return findRecipe(obj['@graph'])
}

function recipeFromHtml(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const found = findRecipe(JSON.parse(m[1]))
      if (found) return found
    } catch {
      /* not valid JSON: ignore this block */
    }
  }
  return null
}

/** "4", "4 servings", "Serves 4-6", ["4", "4 servings"], 4  ->  first number found, if it is a plausible serving count. */
function parseYield(value: unknown): number | null {
  const text = Array.isArray(value) ? value.map(String).join(' ') : value == null ? '' : String(value)
  const m = text.match(/\d+(?:\.\d+)?/)
  const n = m ? Number(m[0]) : NaN
  return Number.isFinite(n) && n >= 1 && n <= 48 ? n : null
}

/** ISO 8601 duration such as PT1H30M -> minutes. */
function parseMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = value.match(/^P(?:\d+D)?T?(?:(\d+)H)?(?:(\d+)M)?/i)
  if (!m) return null
  const total = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
  return total > 0 && total <= 24 * 60 ? total : null
}

const num = (v: unknown): number | null => {
  const m = String(v ?? '').match(/\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

// ---- main ----
type Result = {
  seedId: string
  title: string
  url: string
  status: 'ok' | 'robots' | 'blocked' | 'no-recipe-data' | 'no-servings' | 'error'
  servings?: number
  minutes?: number
  kcal?: number
  protein?: number
}
const results: Result[] = []

for (const [i, r] of recipes.entries()) {
  const base: Result = { seedId: r.seedId, title: r.title, url: r.source, status: 'error' }
  let url: URL
  try {
    url = new URL(r.source)
  } catch {
    results.push(base)
    continue
  }
  url.hash = ''
  try {
    const rules = await rulesFor(url.origin)
    if (rules !== 'unreachable' && !allowed(rules, url.pathname + url.search)) {
      results.push({ ...base, status: 'robots' })
      continue
    }
    await sleep(1100)
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(25000), redirect: 'follow' })
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      results.push({ ...base, status: 'blocked' })
    } else if (!res.ok) {
      results.push({ ...base, status: 'error' })
    } else {
      const recipe = recipeFromHtml(await res.text())
      if (!recipe) results.push({ ...base, status: 'no-recipe-data' })
      else {
        const servings = parseYield(recipe.recipeYield)
        const nutrition = (recipe.nutrition ?? {}) as Record<string, unknown>
        const minutes = parseMinutes(recipe.totalTime) ?? ((parseMinutes(recipe.prepTime) ?? 0) + (parseMinutes(recipe.cookTime) ?? 0) || null)
        results.push({
          ...base,
          status: servings ? 'ok' : 'no-servings',
          servings: servings ?? undefined,
          minutes: minutes ?? undefined,
          kcal: num(nutrition.calories) ?? undefined,
          protein: num(nutrition.proteinContent) ?? undefined,
        })
      }
    }
  } catch {
    results.push(base)
  }
  if ((i + 1) % 20 === 0) console.log(`${i + 1} / ${recipes.length}`)
}

writeFileSync(join(outDir, 'yields-raw.json'), JSON.stringify(results, null, 1))

// Only numbers go into the app's data folder.
const keep: Record<string, { servings: number; minutes?: number }> = {}
for (const r of results) if (r.status === 'ok') keep[r.seedId] = { servings: r.servings!, ...(r.minutes ? { minutes: r.minutes } : {}) }
mkdirSync(join(here, 'data'), { recursive: true })
writeFileSync(join(here, 'data', 'source-yields.json'), JSON.stringify(keep, null, 1))

const tally: Record<string, number> = {}
for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1
console.log('Done.', JSON.stringify(tally), `| servings found for ${Object.keys(keep).length} of ${recipes.length}`)
