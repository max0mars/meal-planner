import type { Ingredient, Recipe } from '../types'

/** Staples worth flagging when the steps serve a dish with them but the ingredient list leaves them out. */
const STAPLES: Record<string, number> = {
  // name -> typical raw grams per serving
  'White rice': 75, 'Brown rice': 75, 'Wheat pasta': 75, 'Whole wheat pasta': 75, 'Gluten-free pasta': 75, 'Rice noodles': 75,
  Quinoa: 70, Couscous: 70, Lentils: 60, 'White bread': 60, 'Whole wheat bread': 60, Baguette: 60, 'Pita bread': 60,
  'Corn tortillas': 50, 'Flour tortillas': 50, Potato: 200, 'Sweet potato': 200,
}

/** "serve with plain rice", "served over noodles", "serve alongside warm bread": the words after with/over/on/alongside. */
const SERVE_WITH = /\bserv(?:e|ed|es|ing)\b[^.!?]*?\b(?:with|over|on|alongside|and)\b([^.!?]*)/gi

const norm = (s: string) => s.toLowerCase().replace(/-/g, ' ')

export interface UnlistedStaple {
  ingredient: Ingredient
  /** The word in the steps that gave it away, such as "rice". */
  mention: string
  /** Typical raw grams for one serving, to offer as a starting amount. */
  gramsPerServing: number
}

/**
 * Finds staples the steps say to serve with, which are not in the ingredient list. Their calories, protein and
 * sensitivities are invisible to the app until they are added, so the recipe screen points them out.
 */
export function unlistedStaples(recipe: Pick<Recipe, 'steps' | 'ingredients'>, foods: Ingredient[]): UnlistedStaple[] {
  const phrases = recipe.steps.flatMap((s) => [...s.matchAll(SERVE_WITH)].map((m) => norm(m[1])))
  if (phrases.length === 0) return []

  const inRecipe = new Set(recipe.ingredients.map((l) => l.ingredientId))
  // Words that already name something in the recipe (so "serve with noodles" is not flagged when noodles are listed).
  const listedWords = new Set(
    foods.filter((f) => inRecipe.has(f.id!)).flatMap((f) => [f.name, ...f.aliases].map(norm)),
  )

  const claimed = new Set<string>()
  const found: UnlistedStaple[] = []
  for (const food of foods) {
    const grams = STAPLES[food.name]
    if (grams == null || inRecipe.has(food.id!)) continue
    for (const term of [food.name, ...food.aliases].map(norm)) {
      if (claimed.has(term) || listedWords.has(term)) continue
      const word = new RegExp(`(?:^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|es)?(?![a-z])`)
      if (phrases.some((p) => word.test(p))) {
        // The first food listed for a shared word wins ("rice" is White rice), and later ones are not suggested for it.
        claimed.add(term)
        found.push({ ingredient: food, mention: term, gramsPerServing: grams })
        break
      }
    }
  }
  return found
}
