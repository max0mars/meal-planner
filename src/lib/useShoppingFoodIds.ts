import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { todayIso } from './pantry'
import { cookSessions } from './plan'
import { buildShoppingList } from './shopping'
import { useRecipeRows } from './useRecipeRows'

/** The foods on your shopping list right now, so a scanned receipt can say which of its items you were waiting for. */
export function useShoppingFoodIds(): Set<number> {
  const kitchen = useRecipeRows()
  const entries = useLiveQuery(() => db.mealPlan.toArray(), [])
  const pantry = useLiveQuery(() => db.pantryItems.toArray(), [])
  return useMemo(() => {
    if (!kitchen || !entries || !pantry) return new Set<number>()
    const today = todayIso()
    const sessions = cookSessions(entries.filter((e) => e.date >= today), kitchen.data.settings.leftoverShelfLifeDays)
    const list = buildShoppingList(sessions, new Map(kitchen.rows.map((r) => [r.recipe.id, r.recipe])), kitchen.data.byId, pantry.filter((p) => p.expiresOn >= today))
    return new Set(list.toBuy.map((i) => i.food.id!))
  }, [kitchen, entries, pantry])
}
