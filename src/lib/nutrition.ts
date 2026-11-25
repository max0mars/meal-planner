import type { Ingredient, Recipe, RecipeIngredient } from '../types'
import { toGrams } from './units'

export interface RecipeLineWeight {
  line: RecipeIngredient
  ingredient: Ingredient
  /** Null when the unit could not be converted to grams. */
  grams: number | null
}

export interface RecipeNutrition {
  totalKcal: number
  totalProtein: number
  kcalPerServing: number
  proteinPerServing: number
  totalGrams: number
  /** Ingredients that could not be converted to grams, so are not counted in the totals. */
  uncounted: Ingredient[]
}

export function lineWeights(recipe: Pick<Recipe, 'ingredients'>, byId: Map<number, Ingredient>): RecipeLineWeight[] {
  const out: RecipeLineWeight[] = []
  for (const line of recipe.ingredients) {
    const ingredient = byId.get(line.ingredientId)
    if (ingredient) out.push({ line, ingredient, grams: toGrams(line.qty, line.unit, ingredient) })
  }
  return out
}

/** Calories and protein for a whole recipe and per serving. Nutrition values are for raw ingredients. */
export function recipeNutrition(recipe: Pick<Recipe, 'ingredients' | 'servings'>, byId: Map<number, Ingredient>): RecipeNutrition {
  let totalKcal = 0
  let totalProtein = 0
  let totalGrams = 0
  const uncounted: Ingredient[] = []
  for (const { ingredient, grams } of lineWeights(recipe, byId)) {
    if (grams == null) {
      uncounted.push(ingredient)
      continue
    }
    totalGrams += grams
    totalKcal += (grams * ingredient.kcalPer100g) / 100
    totalProtein += (grams * ingredient.proteinPer100g) / 100
  }
  const servings = Math.max(1, recipe.servings)
  return {
    totalKcal,
    totalProtein,
    kcalPerServing: totalKcal / servings,
    proteinPerServing: totalProtein / servings,
    totalGrams,
    uncounted,
  }
}
