import type { Ingredient, PantryItem, Recipe } from '../types'
import { addDays } from './expiry'
import { SOON_DAYS } from './pantry'
import { isStaple } from './shopping'
import { toGrams } from './units'

export interface PantryMatch {
  /** Foods in one meal of the recipe, not counting staples such as salt and oil. */
  total: number
  /** How many of those foods the pantry covers, in the amount one meal needs. */
  have: number
  /** Names of the foods the pantry does not cover. */
  missing: string[]
  /** Names of covered foods that run out of shelf life within a few days of `today`. */
  soon: string[]
}

/**
 * How much of one meal of a recipe your pantry covers on a given day. Only food that is still good on `date` counts.
 * A food whose amount cannot be weighed is left out rather than guessed.
 */
export function pantryMatch(
  recipe: Pick<Recipe, 'ingredients' | 'servings' | 'servingsPerMeal'>,
  pantry: PantryItem[],
  byId: Map<number, Ingredient>,
  date: string,
  today: string,
): PantryMatch {
  const scale = (recipe.servingsPerMeal || 1) / (recipe.servings || 1)
  const soonLimit = addDays(today, SOON_DAYS)
  const result: PantryMatch = { total: 0, have: 0, missing: [], soon: [] }
  const seen = new Set<number>()
  for (const line of recipe.ingredients) {
    const food = byId.get(line.ingredientId)
    // an optional food you don't have doesn't make the meal any less possible
    if (!food || isStaple(food) || line.optional || seen.has(line.ingredientId)) continue
    const needed = toGrams(line.qty * scale, line.unit, food)
    if (needed == null || needed <= 0) continue
    seen.add(line.ingredientId)
    // a food can appear on two lines; count each food once, against the amount of its first line
    const lots = pantry.filter((p) => p.ingredientId === line.ingredientId && p.expiresOn >= date)
    const available = lots.reduce((sum, p) => sum + (toGrams(p.qty, p.unit, food) ?? 0), 0)
    result.total++
    if (available >= needed) {
      result.have++
      if (lots.some((p) => p.expiresOn <= soonLimit)) result.soon.push(food.name)
    } else {
      result.missing.push(food.name)
    }
  }
  return result
}

/** Best first: uses food about to expire, then covers the most of what the meal needs. Null when nothing in the pantry helps. */
export function pantryScore(m: PantryMatch): number | null {
  if (m.total === 0 || m.have === 0) return null
  const coverage = m.have / m.total
  if (coverage < 0.6) return null
  return m.soon.length * 2 + coverage * 3
}
