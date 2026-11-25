import { db } from '../db'
import type { Recipe } from '../types'

export type Rating = NonNullable<Recipe['rating']>

/** Tapping the rating you already gave clears it; tapping the other one switches. */
export function nextRating(current: Recipe['rating'], tapped: Rating): Recipe['rating'] {
  return current === tapped ? undefined : tapped
}

/** Stored on the recipe itself, so reseeding starter recipes never overwrites it. */
export function toggleRating(recipeId: number, tapped: Rating) {
  return db.transaction('rw', db.recipes, async () => {
    const recipe = await db.recipes.get(recipeId)
    if (!recipe) return
    await db.recipes.update(recipeId, { rating: nextRating(recipe.rating, tapped) })
  })
}
