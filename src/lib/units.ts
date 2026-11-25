import type { Ingredient, Unit } from '../types'

export const UNITS: Unit[] = ['g', 'ml', 'piece', 'cup', 'tbsp', 'tsp']

export const ML_PER_UNIT: Partial<Record<Unit, number>> = { ml: 1, tsp: 4.929, tbsp: 14.787, cup: 236.588 }

/** Typical grams per millilitre by category, used when an ingredient has no density of its own. */
const CATEGORY_DENSITY: Record<string, number> = {
  grains: 0.75,
  legumes: 0.8,
  'nuts-seeds': 0.6,
  'spices-herbs': 0.45,
  'fats-oils': 0.92,
  produce: 0.5,
  fruit: 0.6,
}

type Convertible = Pick<Ingredient, 'category' | 'gramsPerPiece' | 'gramsPerMl'>

/**
 * Converts an amount to grams. Returns null when it cannot be done reliably,
 * for example "2 pieces" of something with no known piece weight.
 */
export function toGrams(qty: number, unit: Unit, ingredient: Convertible): number | null {
  if (unit === 'g') return qty
  if (unit === 'piece') return ingredient.gramsPerPiece != null ? qty * ingredient.gramsPerPiece : null
  const ml = ML_PER_UNIT[unit]
  if (ml == null) return null
  const density = ingredient.gramsPerMl ?? CATEGORY_DENSITY[ingredient.category] ?? 1
  return qty * ml * density
}
