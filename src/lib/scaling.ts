import type { Ingredient, PantryItem, RecipeIngredient, Unit } from '../types'
import { toGrams } from './units'

// ---------- scaling ----------

/** Multiply every amount in a recipe by `factor`. The recipe itself is never changed. */
export function scaleLines(lines: RecipeIngredient[], factor: number): RecipeIngredient[] {
  return lines.map((l) => ({ ...l, qty: l.qty * factor }))
}

/** The multiplier that turns a recipe for `recipeServings` into one for `target` servings. */
export function factorForServings(target: number, recipeServings: number): number {
  return recipeServings > 0 ? target / recipeServings : 1
}

// ---------- friendly amounts ----------

const trim = (n: number, places: number) => String(Number(n.toFixed(places)))

/** Fractions that read naturally for each unit, as [value, glyph]. */
const FRACTIONS: Record<'tsp' | 'tbsp' | 'cup' | 'piece', [number, string][]> = {
  tsp: [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 2, '½'], [3 / 4, '¾']],
  tbsp: [[1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾']],
  cup: [[1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾']],
  piece: [[1 / 4, '¼'], [1 / 2, '½'], [3 / 4, '¾']],
}

/** "1½", "¾", "2": the nearest friendly number for a spoon, cup or piece amount. Never rounds a real amount down to zero. */
function mixedNumber(x: number, unit: keyof typeof FRACTIONS): string {
  const options: [number, string][] = [[0, ''], ...FRACTIONS[unit], [1, '']]
  const whole = Math.floor(x)
  const frac = x - whole
  const [value, glyph] = options.reduce((best, o) => (Math.abs(o[0] - frac) < Math.abs(best[0] - frac) ? o : best))
  if (value === 1) return String(whole + 1)
  if (whole === 0 && value === 0) return FRACTIONS[unit][0][1] // a small but real amount: show the smallest fraction
  return `${whole > 0 ? whole : ''}${glyph}`
}

/**
 * How to show an amount to a person: grams and millilitres rounded sensibly, spoons and cups as fractions,
 * and bigger units when the number gets large (3 tsp becomes 1 tbsp, 1200 g becomes 1.2 kg).
 */
export function formatAmount(qty: number, unit: Unit): string {
  if (unit === 'g' || unit === 'ml') {
    const big = unit === 'g' ? 'kg' : 'L'
    if (qty >= 1000) return `${trim(qty / 1000, 2)} ${big}`
    if (qty >= 100) return `${Math.round(qty / 5) * 5} ${unit}`
    if (qty >= 10) return `${Math.round(qty)} ${unit}`
    return `${trim(qty, 1)} ${unit}`
  }
  if (unit === 'piece') {
    const n = mixedNumber(qty, 'piece')
    return `${n} ${qty <= 1 ? 'piece' : 'pieces'}`
  }
  // spoons and cups: move up a size when it reads better
  let value = qty
  let u: 'tsp' | 'tbsp' | 'cup' = unit
  if (u === 'tsp' && value >= 3) {
    value /= 3
    u = 'tbsp'
  }
  if (u === 'tbsp' && value >= 16) {
    value /= 16
    u = 'cup'
  }
  if (u === 'tsp' && value < 1 / 16) return 'a pinch'
  const text = mixedNumber(value, u)
  const plural = u === 'cup' && value > 1.0625
  return `${text} ${u === 'cup' ? (plural ? 'cups' : 'cup') : u}`
}

/** A servings count for display: whole numbers as they are, otherwise one decimal (3.4). */
export function formatServings(n: number): string {
  return Number.isInteger(n) ? String(n) : trim(n, 1)
}

// ---------- what you have ----------

/** Seasonings and water are assumed to be in the cupboard, so they never limit how much you can make. */
function assumedOnHand(food: Ingredient): boolean {
  return food.category === 'spices-herbs' || /^(water|salt)\b/i.test(food.name)
}

/** Total grams of a food in the pantry. Null when none of it is there. `partial` is true if some of it could not be weighed. */
export function pantryGrams(
  ingredientId: number,
  items: PantryItem[],
  byId: Map<number, Ingredient>,
): { grams: number; partial: boolean } | null {
  const food = byId.get(ingredientId)
  const mine = items.filter((i) => i.ingredientId === ingredientId && i.qty > 0)
  if (!food || mine.length === 0) return null
  let grams = 0
  let partial = false
  for (const item of mine) {
    const g = toGrams(item.qty, item.unit, food)
    if (g == null) partial = true
    else grams += g
  }
  return { grams, partial }
}

export type CoverageStatus = 'enough' | 'short' | 'none' | 'unknown' | 'assumed'

export interface LineCoverage {
  status: CoverageStatus
  /** Grams in the pantry, when there is any. */
  haveGrams?: number
  /** Grams the (scaled) recipe needs. */
  needGrams?: number
  shortByGrams?: number
}

/** For each recipe line, does your pantry cover the (already scaled) amount? */
export function lineCoverage(line: RecipeIngredient, items: PantryItem[], byId: Map<number, Ingredient>): LineCoverage {
  const food = byId.get(line.ingredientId)
  if (!food) return { status: 'unknown' }
  if (assumedOnHand(food)) return { status: 'assumed' }
  const need = toGrams(line.qty, line.unit, food)
  const have = pantryGrams(line.ingredientId, items, byId)
  if (need == null) return { status: have ? 'unknown' : 'none', haveGrams: have?.grams }
  if (!have) return { status: 'none', needGrams: need }
  if (have.partial && have.grams < need) return { status: 'unknown', haveGrams: have.grams, needGrams: need }
  if (have.grams + 0.5 >= need) return { status: 'enough', haveGrams: have.grams, needGrams: need }
  return { status: 'short', haveGrams: have.grams, needGrams: need, shortByGrams: need - have.grams }
}

export type PantryCapacity =
  | { kind: 'max'; factor: number; limiting: Ingredient }
  | { kind: 'missing'; foods: Ingredient[] }

/**
 * The most you could make with your pantry, as a multiplier of the recipe as written, and which food runs out first.
 * Or, if some ingredient is not in the pantry at all, which ones are missing. Null if the pantry is empty.
 */
export function pantryCapacity(lines: RecipeIngredient[], items: PantryItem[], byId: Map<number, Ingredient>): PantryCapacity | null {
  if (items.length === 0) return null
  const missing: Ingredient[] = []
  let best: { factor: number; limiting: Ingredient } | null = null
  for (const line of lines) {
    const food = byId.get(line.ingredientId)
    if (!food || assumedOnHand(food)) continue
    const need = toGrams(line.qty, line.unit, food)
    if (need == null || need <= 0) continue
    const have = pantryGrams(line.ingredientId, items, byId)
    if (!have || have.grams <= 0) {
      missing.push(food)
      continue
    }
    const factor = have.grams / need
    if (!best || factor < best.factor) best = { factor, limiting: food }
  }
  if (missing.length > 0) return { kind: 'missing', foods: missing }
  return best ? { kind: 'max', ...best } : null
}
