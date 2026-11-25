import type { Ingredient, PantryItem, Recipe, UsedPantry } from '../types'
import { isStaple } from './shopping'
import { toGrams } from './units'

const round = (n: number) => Math.round(n * 100) / 100

/**
 * What cooking `servings` of a recipe takes from the pantry: each food from the items that go off soonest first, only
 * from food still good on `today`. Seasonings are not tracked, and an item that cannot be weighed is left alone rather
 * than guessed. An item that is used up is taken down to nothing (and removed by the caller). Returns the new amount of
 * every item touched, and a record of what was taken so it can be put back.
 */
export function takeFromPantry(
  recipe: Pick<Recipe, 'ingredients' | 'servings'>,
  servings: number,
  pantry: PantryItem[],
  byId: Map<number, Ingredient>,
  today: string,
  /** Foods you borrowed for this meal: they are not taken from your pantry. */
  borrowed: number[] = [],
): { changes: { item: PantryItem; qty: number }[]; used: UsedPantry[] } {
  const factor = servings / Math.max(1, recipe.servings)
  const left = new Map(pantry.map((p) => [p.id!, p.qty]))
  const used = new Map<number, UsedPantry>()
  for (const line of recipe.ingredients) {
    const food = byId.get(line.ingredientId)
    if (!food || isStaple(food) || borrowed.includes(food.id!)) continue
    let need = toGrams(line.qty * factor, line.unit, food)
    if (need == null || need <= 0) continue
    const lots = pantry.filter((p) => p.ingredientId === food.id && p.expiresOn >= today).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
    for (const lot of lots) {
      if (need <= 0) break
      const qty = left.get(lot.id!)!
      const perUnit = toGrams(1, lot.unit, food)
      if (!perUnit || qty <= 0) continue
      const take = Math.min(qty, need / perUnit)
      const after = qty - take
      // a crumb left over (under half a gram, or a hundredth of a piece) counts as used up
      const next = after * perUnit < 0.5 || after < 0.01 ? 0 : round(after)
      left.set(lot.id!, next)
      need -= take * perUnit
      const record = used.get(lot.id!) ?? { id: lot.id!, took: 0, before: lot }
      record.took = round(lot.qty - next)
      used.set(lot.id!, record)
    }
  }
  const changes = [...used.values()].map((u) => ({ item: u.before, qty: left.get(u.id)! }))
  return { changes, used: [...used.values()] }
}
