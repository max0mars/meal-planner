import { CATEGORY_BY_ID } from '../data/categories'
import type { Ingredient, PantryItem, Recipe, RecipeIngredient, Sensitivity } from '../types'
import { effectiveSensitivity } from './sensitivity'
import { toGrams } from './units'

/*
 * Flexible recipes. Any ingredient line in a recipe can be:
 * - flexible: filled by any food in a category ("any meat") and/or by any of a list of foods ("any pasta"). The line's own
 *   food is the default choice, and `label` names the line ("Meat").
 * - optional: the recipe works without it, so it is left out when it is not safe for you.
 *
 * A recipe is stored with these lines as written. Before anything is worked out from it (calories, the sensitivity check,
 * the shopping list, what the pantry covers), `resolveRecipe` turns every flexible line into one actual food and drops
 * optional lines you should not eat. Everything downstream then sees a plain recipe.
 */

/** True when the line can be filled by more than one food. */
export function isFlexible(line: Pick<RecipeIngredient, 'anyOf' | 'anyCategory'>): boolean {
  return (line.anyOf?.length ?? 0) > 0 || !!line.anyCategory
}

/** True when any line of the recipe is flexible or optional. */
export function isFlexibleRecipe(recipe: Pick<Recipe, 'ingredients'>): boolean {
  return recipe.ingredients.some((l) => isFlexible(l) || l.optional)
}

/**
 * Every food that can fill a line, best known first: the line's own food, then the listed foods in their order, then the
 * rest of the category by name. Foods that no longer exist are skipped.
 */
export function candidatesFor(line: RecipeIngredient, byId: Map<number, Ingredient>): Ingredient[] {
  const out: Ingredient[] = []
  const seen = new Set<number>()
  const add = (food: Ingredient | undefined) => {
    if (food?.id == null || seen.has(food.id)) return
    seen.add(food.id)
    out.push(food)
  }
  add(byId.get(line.ingredientId))
  for (const id of line.anyOf ?? []) add(byId.get(id))
  if (line.anyCategory) {
    ;[...byId.values()]
      .filter((f) => f.category === line.anyCategory)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(add)
  }
  return out
}

/** What the line is called: its label, else "Any meat" for a category, else the default food's name. */
export function lineName(line: RecipeIngredient, byId: Map<number, Ingredient>): string {
  if (line.label?.trim()) return line.label.trim()
  if (line.anyCategory) return `Any ${(CATEGORY_BY_ID.get(line.anyCategory)?.label ?? line.anyCategory).toLowerCase()}`
  return byId.get(line.ingredientId)?.name ?? 'Unknown food'
}

/** The choices of a flexible line in words: "any meat", "Wheat pasta, Whole wheat pasta or Gluten-free pasta". */
export function describeChoices(line: RecipeIngredient, byId: Map<number, Ingredient>): string {
  const listed = [line.ingredientId, ...(line.anyOf ?? [])].map((id) => byId.get(id)?.name).filter((n): n is string => !!n)
  const names = [...new Set(listed)]
  const category = line.anyCategory ? `any ${(CATEGORY_BY_ID.get(line.anyCategory)?.label ?? line.anyCategory).toLowerCase()}` : ''
  if (category) return category
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

const RANK: Record<Sensitivity, number> = { safe: 0, light: 1, major: 2 }

export interface ResolveContext {
  byId: Map<number, Ingredient>
  /** Your sensitivity per category (gluten, dairy...). */
  levels: Map<string, Sensitivity>
  /** Food you have. Only what is still good on `date` counts. Leave out to pick without looking at the pantry. */
  pantry?: PantryItem[]
  /** The day the food is needed (YYYY-MM-DD). */
  date?: string
}

export interface DroppedLine {
  line: RecipeIngredient
  food: Ingredient
  level: Sensitivity
  /** Where the line is in the saved recipe. */
  index: number
  /** True when you chose to leave it out; false when it was left out because it is not safe for you. */
  chosen: boolean
}

export interface ResolvedRecipe<R extends Pick<Recipe, 'ingredients'>> {
  recipe: R
  /** Optional lines left out because the food is not safe for you. */
  dropped: DroppedLine[]
  /** For each line of `recipe`, the position of the saved line it came from, so a change can be saved back to it. */
  sourceIndex: number[]
}

/** Grams of a food in the pantry that are still good on `date`. */
function stockGrams(food: Ingredient, pantry: PantryItem[], date: string | undefined): number {
  return pantry
    .filter((p) => p.ingredientId === food.id && (!date || p.expiresOn >= date))
    .reduce((sum, p) => sum + (toGrams(p.qty, p.unit, food) ?? 0), 0)
}

/**
 * Picks the food for one flexible line: the safest for you first; among equally safe foods, one the pantry has enough of,
 * then one it has some of (the most), then the order the recipe lists them in.
 */
export function chooseFood(line: RecipeIngredient, ctx: ResolveContext): Ingredient | undefined {
  const options = candidatesFor(line, ctx.byId)
  if (options.length <= 1) return options[0]
  const need = (food: Ingredient) => toGrams(line.qty, line.unit, food) ?? 0
  const scored = options.map((food, order) => {
    const have = ctx.pantry ? stockGrams(food, ctx.pantry, ctx.date) : 0
    return { food, order, rank: RANK[effectiveSensitivity(food, ctx.levels).level], enough: have > 0 && have >= need(food), have }
  })
  scored.sort((a, b) => a.rank - b.rank || Number(b.enough) - Number(a.enough) || b.have - a.have || a.order - b.order)
  return scored[0].food
}

/**
 * The recipe as you would cook it: every flexible line filled with one food (see `chooseFood`), and optional lines left out
 * when their food is not safe for you. Each line keeps its flexible and optional details, so it can still be shown as such.
 */
export function resolveRecipe<R extends Pick<Recipe, 'ingredients'>>(recipe: R, ctx: ResolveContext): ResolvedRecipe<R> {
  if (!isFlexibleRecipe(recipe)) return { recipe, dropped: [], sourceIndex: recipe.ingredients.map((_, i) => i) }
  const lines: RecipeIngredient[] = []
  const dropped: DroppedLine[] = []
  const sourceIndex: number[] = []
  for (const [index, line] of recipe.ingredients.entries()) {
    // a food you picked is used as it is, unless it has since been deleted
    const picked = line.picked ? ctx.byId.get(line.ingredientId) : undefined
    const food = picked ?? (isFlexible(line) ? chooseFood(line, ctx) : ctx.byId.get(line.ingredientId))
    if (!food) {
      lines.push(line) // unknown food: keep the line as it is, as for any recipe
      sourceIndex.push(index)
      continue
    }
    const level = effectiveSensitivity(food, ctx.levels).level
    if (line.optional && (line.leftOut || level !== 'safe')) {
      dropped.push({ line, food, level, index, chosen: !!line.leftOut })
      continue
    }
    lines.push(food.id === line.ingredientId ? line : withFood(line, food.id!))
    sourceIndex.push(index)
  }
  return { recipe: { ...recipe, ingredients: lines }, dropped, sourceIndex }
}

/** The line with a different food in it. The food it had joins the other choices, so the line still lists every food it can be. */
function withFood(line: RecipeIngredient, foodId: number): RecipeIngredient {
  const others = [line.ingredientId, ...(line.anyOf ?? [])].filter((id) => id !== foodId)
  return { ...line, ingredientId: foodId, anyOf: [...new Set(others)] }
}

/** An optional line used (`use` true) or left out when you make the recipe. */
export function setOptionalUse(line: RecipeIngredient, use: boolean): RecipeIngredient {
  if (use) {
    const { leftOut: _leftOut, ...rest } = line
    return rest
  }
  return { ...line, leftOut: true }
}

/**
 * A flexible line set to the food you picked, or (with `foodId` undefined) back to being chosen for you. Picking keeps
 * every other choice on the line, and the food you picked becomes its default.
 */
export function pickFood(line: RecipeIngredient, foodId: number | undefined): RecipeIngredient {
  if (foodId == null) {
    const { picked: _picked, ...rest } = line
    return rest
  }
  return { ...(foodId === line.ingredientId ? line : withFood(line, foodId)), picked: true }
}
