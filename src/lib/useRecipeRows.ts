import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Recipe } from '../types'
import { isPreferred } from './cuisine'
import { resolveRecipe, type DroppedLine } from './flexible'
import { recipeNutrition } from './nutrition'
import { todayIso } from './pantry'
import type { Candidate } from './planner'
import { recipeDishes, recipeKinds } from './recipeFilters'
import { classifyRecipe, type RecipeSafety } from './recipeSafety'
import { useKitchenData } from './useKitchenData'

export interface RecipeRow {
  /** The recipe as you would cook it: flexible lines filled with one food, unsafe optional lines left out. */
  recipe: Recipe & { id: number }
  /** The recipe as saved, with its flexible and optional lines. Edit this one, never `recipe`. */
  saved: Recipe & { id: number }
  /** Optional lines left out because they are not safe for you. */
  dropped: DroppedLine[]
  nutrition: ReturnType<typeof recipeNutrition>
  safety: RecipeSafety
  kinds: ReturnType<typeof recipeKinds>
  dishes: ReturnType<typeof recipeDishes>
}

/** Every recipe with its calories and protein, its sensitivity check, and what kind of dish it is. Null until loaded. */
export function useRecipeRows() {
  const recipes = useLiveQuery(() => db.recipes.toArray(), [])
  // flexible lines prefer food you have, so the pantry is needed to fill them
  const pantry = useLiveQuery(() => db.pantryItems.toArray(), [])
  const data = useKitchenData()
  return useMemo(() => {
    if (!recipes || !data || !pantry) return null
    const today = todayIso()
    const rows: RecipeRow[] = recipes.map((r) => {
      const saved = r as Recipe & { id: number }
      const { recipe, dropped } = resolveRecipe(saved, { byId: data.byId, levels: data.levels, pantry, date: today })
      return {
        recipe,
        saved,
        dropped,
        nutrition: recipeNutrition(recipe, data.byId),
        safety: classifyRecipe(recipe, data.byId, data.levels, data.combinedCap, data.defaultLimit),
        kinds: recipeKinds(recipe, data.byId),
        dishes: recipeDishes(recipe, data.byId),
      }
    })
    // what the planner may choose from: nothing you should avoid, and nothing you said you dislike
    const candidates: Candidate[] = rows
      .filter((r) => r.safety.status !== 'excluded' && r.recipe.rating !== 'dislike')
      .map((r) => ({
        recipe: r.recipe,
        perServing: { kcal: r.nutrition.kcalPerServing, protein: r.nutrition.proteinPerServing },
        kinds: r.kinds,
        warn: r.safety.status === 'warn',
        familiar: isPreferred(r.recipe.cuisine, data.settings.preferredCuisines),
        liked: r.recipe.rating === 'like',
      }))
    return { rows, candidates, recipeById: new Map(rows.map((r) => [r.recipe.id, r])), data }
  }, [recipes, data, pantry])
}
