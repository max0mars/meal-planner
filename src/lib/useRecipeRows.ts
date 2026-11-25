import { useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { Recipe } from '../types'
import { isPreferred } from './cuisine'
import { recipeNutrition } from './nutrition'
import type { Candidate } from './planner'
import { recipeDishes, recipeKinds } from './recipeFilters'
import { classifyRecipe, type RecipeSafety } from './recipeSafety'
import { useKitchenData } from './useKitchenData'

export interface RecipeRow {
  recipe: Recipe & { id: number }
  nutrition: ReturnType<typeof recipeNutrition>
  safety: RecipeSafety
  kinds: ReturnType<typeof recipeKinds>
  dishes: ReturnType<typeof recipeDishes>
}

/** Every recipe with its calories and protein, its sensitivity check, and what kind of dish it is. Null until loaded. */
export function useRecipeRows() {
  const recipes = useLiveQuery(() => db.recipes.toArray(), [])
  const data = useKitchenData()
  return useMemo(() => {
    if (!recipes || !data) return null
    const rows: RecipeRow[] = recipes.map((r) => {
      const recipe = r as Recipe & { id: number }
      return {
        recipe,
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
  }, [recipes, data])
}
