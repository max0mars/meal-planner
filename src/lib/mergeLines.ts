import type { Ingredient, RecipeIngredient } from '../types'
import { toGrams } from './units'

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Combines lines that name the same food into one: "250 g haddock" and "250 g smoked haddock" become "500 g haddock".
 * Lines in the same unit are added. Lines in different units (1 tbsp butter and 75 g butter) are added in grams when
 * both can be weighed, and otherwise left as they are. The order follows the first time each food appears, and the
 * calories, protein and shopping needs are exactly the same as before: only how the list reads changes.
 */
export function mergeDuplicateLines(lines: RecipeIngredient[], byId: Map<number, Ingredient>): RecipeIngredient[] {
  const groups = new Map<number, RecipeIngredient[]>()
  for (const line of lines) groups.set(line.ingredientId, [...(groups.get(line.ingredientId) ?? []), line])

  const out: RecipeIngredient[] = []
  const done = new Set<number>()
  for (const line of lines) {
    if (done.has(line.ingredientId)) continue
    done.add(line.ingredientId)
    const group = groups.get(line.ingredientId)!
    if (group.length === 1) {
      out.push(line)
    } else if (group.every((l) => l.unit === group[0].unit)) {
      out.push({ ...group[0], qty: round(group.reduce((sum, l) => sum + l.qty, 0)) })
    } else {
      const food = byId.get(line.ingredientId)
      const grams = food ? group.map((l) => toGrams(l.qty, l.unit, food)) : []
      if (food && grams.every((g): g is number => g != null)) {
        out.push({ ingredientId: line.ingredientId, qty: round(grams.reduce((a, b) => a + b, 0)), unit: 'g' })
      } else {
        out.push(...group) // cannot be added up reliably, so keep every line
      }
    }
  }
  return out
}
