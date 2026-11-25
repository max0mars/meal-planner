import { db } from '../db'
import type { Ingredient } from '../types'
import { emptyDraft, shelfForCategory, type FoodDraft } from './customFood'

// ---------- reading a barcode number ----------

/** GS1 check digit: from the right, skipping the check digit, weights alternate 3, 1, 3, 1 ... */
export function hasValidCheckDigit(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false
  const body = digits.slice(0, -1)
  let sum = 0
  for (let i = 0; i < body.length; i++) sum += Number(body[body.length - 1 - i]) * (i % 2 === 0 ? 3 : 1)
  return (10 - (sum % 10)) % 10 === Number(digits.slice(-1))
}

/** The short UPC-E form back to its full 12 digits, or null if it is not one. */
function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null
  const [ns, a, b, c, d, e, f, check] = code
  const mid =
    f === '0' || f === '1' || f === '2' ? `${a}${b}${f}00` + `00${c}${d}${e}` : f === '3' ? `${a}${b}${c}00` + `000${d}${e}` : f === '4' ? `${a}${b}${c}${d}0` + `0000${e}` : `${a}${b}${c}${d}${e}` + `0000${f}`
  const full = `${ns}${mid}${check}`
  return hasValidCheckDigit(full) ? full : null
}

/**
 * One form for every barcode so the same product is always found: UPC-A (12 digits) becomes EAN-13 with a leading 0,
 * a 14-digit GTIN loses a leading 0, and a short UPC-E is expanded. Returns null for anything that is not a real
 * barcode (wrong length or a failed check digit), which catches most misreads and mistyped digits.
 */
export function normalizeBarcode(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 8) {
    if (hasValidCheckDigit(digits)) return digits // EAN-8
    const full = expandUpcE(digits)
    return full ? `0${full}` : null
  }
  if (digits.length === 12) return hasValidCheckDigit(digits) ? `0${digits}` : null
  if (digits.length === 13) return hasValidCheckDigit(digits) ? digits : null
  if (digits.length === 14) return digits.startsWith('0') && hasValidCheckDigit(digits) ? digits.slice(1) : null
  return null
}

// ---------- what Open Food Facts tells us ----------

export interface Product {
  barcode: string
  name: string
  brand?: string
  /** Per 100 g, or per 100 ml for drinks. Undefined when the database has no figure. */
  kcalPer100g?: number
  proteinPer100g?: number
  /** Allergens the label declares. */
  tags: string[]
  /** "May contain" traces: shown as suggestions, never ticked for you. */
  maybeTags: string[]
  category: string
  /** The pack size, when the label gives one, in g or ml. */
  package?: { qty: number; unit: 'g' | 'ml' }
}

/** Open Food Facts allergen names to ours. */
const ALLERGEN_TAGS: Record<string, string[]> = {
  'en:gluten': ['gluten'],
  'en:milk': ['dairy', 'lactose'],
  'en:eggs': ['egg'],
  'en:soybeans': ['soy'],
  'en:peanuts': ['peanut'],
  'en:nuts': ['tree-nut'],
  'en:sesame-seeds': ['sesame'],
  'en:fish': ['fish'],
  'en:crustaceans': ['shellfish'],
  'en:molluscs': ['shellfish'],
}

const mapAllergens = (tags: unknown): string[] => {
  const out = new Set<string>()
  if (Array.isArray(tags)) for (const t of tags) for (const mine of ALLERGEN_TAGS[String(t)] ?? []) out.add(mine)
  return [...out]
}

/** Broad kind of food from Open Food Facts' category list. Anything unclear is "other pantry food". */
const CATEGORY_RULES: [RegExp, string][] = [
  [/en:(meats?|poultry|sausages|hams|bacons)\b/, 'meat'],
  [/en:(fish|seafood|fishes)\b/, 'seafood'],
  [/en:(dairies|milks|cheeses|yogurts|creams|butters|eggs)\b/, 'dairy-eggs'],
  [/en:(vegetables|fresh-vegetables)\b/, 'produce'],
  [/en:(fruits|fresh-fruits)\b/, 'fruit'],
  [/en:(cereals|breads|pastas|rices|flours|grains|noodles)\b/, 'grains'],
  [/en:(legumes|pulses|beans|lentils)\b/, 'legumes'],
  [/en:(nuts|seeds)\b/, 'nuts-seeds'],
  [/en:(oils|fats|vegetable-oils)\b/, 'fats-oils'],
  [/en:(spices|herbs|condiments-and-spices)\b/, 'spices-herbs'],
]

function guessCategory(tags: unknown): string {
  const joined = Array.isArray(tags) ? tags.map(String).join(' ') : ''
  return CATEGORY_RULES.find(([re]) => re.test(joined))?.[1] ?? 'pantry'
}

/** "400 g", "1.5 L", "500ml", "75 cl" to g or ml. Anything else (like "6 x 330 ml" or "12 slices") is not guessed. */
export function parsePackage(quantity: unknown): Product['package'] {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(kg|g|l|cl|ml)\b\s*$/i.exec(String(quantity ?? ''))
  if (!m) return undefined
  const n = Number(m[1].replace(',', '.'))
  const unit = m[2].toLowerCase()
  if (!(n > 0)) return undefined
  if (unit === 'kg') return { qty: n * 1000, unit: 'g' }
  if (unit === 'g') return { qty: n, unit: 'g' }
  if (unit === 'l') return { qty: n * 1000, unit: 'ml' }
  if (unit === 'cl') return { qty: n * 10, unit: 'ml' }
  return { qty: n, unit: 'ml' }
}

const finite = (v: unknown): number | undefined => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Turns an Open Food Facts response into what we need, or null when it has no usable product. */
export function parseProduct(json: unknown, barcode: string): Product | null {
  const root = json as { status?: number; product?: Record<string, unknown> } | null
  const p = root?.product
  if (!p || root?.status === 0) return null
  const name = String(p.product_name ?? p.product_name_en ?? p.generic_name ?? '').trim()
  if (!name) return null
  const n = (p.nutriments ?? {}) as Record<string, unknown>
  // calories: the kcal figure if there is one, otherwise the kilojoule figure / 4.184
  const kj = finite(n['energy-kj_100g']) ?? finite(n['energy_100g'])
  const kcal = finite(n['energy-kcal_100g']) ?? (kj != null ? Math.round(kj / 4.184) : undefined)
  const brand = String(p.brands ?? '').split(',')[0].trim()
  return {
    barcode,
    name,
    brand: brand || undefined,
    kcalPer100g: kcal != null ? Math.round(kcal) : undefined,
    proteinPer100g: finite(n['proteins_100g']) != null ? Math.round(finite(n['proteins_100g'])! * 10) / 10 : undefined,
    tags: mapAllergens(p.allergens_tags),
    maybeTags: mapAllergens(p.traces_tags).filter((t) => !mapAllergens(p.allergens_tags).includes(t)),
    category: guessCategory(p.categories_tags),
    package: parsePackage(p.quantity),
  }
}

/** The add-a-food form, filled in from a product. You always get to check it before it is saved. */
export function draftFromProduct(product: Product): FoodDraft {
  const d = emptyDraft(product.name)
  return {
    ...d,
    category: product.category,
    kcal: product.kcalPer100g != null ? String(product.kcalPer100g) : '',
    protein: product.proteinPer100g != null ? String(product.proteinPer100g) : '',
    tags: [...product.tags],
    aliases: product.brand && product.brand.toLowerCase() !== product.name.toLowerCase() ? product.brand.toLowerCase() : '',
    shelf: shelfForCategory(product.category),
    barcode: product.barcode,
  }
}

/** What to tell people about gaps in a product record, so a missing number is never mistaken for zero. */
export function productNotices(product: Product): string[] {
  const out: string[] = []
  if (product.kcalPer100g == null) out.push('The database has no calories for this product. Enter them from the label.')
  if (product.proteinPer100g == null) out.push('The database has no protein figure for this product. Enter it from the label, or it counts as 0 g.')
  if (product.maybeTags.length > 0) out.push('The label says it may contain traces of some allergens. They are suggested below but not ticked.')
  return out
}

// ---------- looking a barcode up ----------

export type Lookup =
  | { kind: 'local'; food: Ingredient }
  | { kind: 'found'; product: Product }
  | { kind: 'unknown' }
  | { kind: 'offline' }

const FIELDS = 'product_name,product_name_en,generic_name,brands,nutriments,allergens_tags,traces_tags,quantity,categories_tags'

/**
 * Your own foods first (a barcode you saved before is found instantly and offline), then Open Food Facts. Only the
 * barcode number is sent. The food you save with the barcode attached is what makes the next scan instant.
 */
export async function lookupBarcode(
  code: string,
  { fetchImpl = fetch, timeoutMs = 8000 }: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<Lookup> {
  const local = await db.ingredients.where('barcode').equals(code).first()
  if (local) return { kind: 'local', food: local }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchImpl(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`, {
      signal: controller.signal,
    })
    if (res.status === 404) return { kind: 'unknown' }
    if (!res.ok) return { kind: 'offline' }
    const product = parseProduct(await res.json(), code)
    return product ? { kind: 'found', product } : { kind: 'unknown' }
  } catch {
    return { kind: 'offline' }
  } finally {
    clearTimeout(timer)
  }
}
