import type { Ingredient, Recipe } from '../types'
import { isPreferred } from './cuisine'
import { toGrams } from './units'

export type KindId = 'beef' | 'chicken' | 'fish' | 'pork' | 'vegetarian'

/** The quick-filter buttons, in display order. */
export const KIND_FILTERS: { id: KindId; label: string }[] = [
  { id: 'beef', label: 'Beef' },
  { id: 'chicken', label: 'Chicken' },
  { id: 'fish', label: 'Fish' },
  { id: 'pork', label: 'Pork' },
  { id: 'vegetarian', label: 'Vegetarian' },
]

export type DishId = 'pasta' | 'soup' | 'riceBowl'

/** The dish-type buttons, in display order. A separate grouping from the main-ingredient buttons: beef pasta is both. */
export const DISH_FILTERS: { id: DishId; label: string }[] = [
  { id: 'pasta', label: 'Pasta' },
  { id: 'soup', label: 'Soup' },
  { id: 'riceBowl', label: 'Rice bowl' },
]

const SOUP_TITLE = /\b(soup|chowder|borscht|gazpacho|bisque|corba)\b/i
const PASTA_FOOD = /pasta$/i // Wheat pasta, Whole wheat pasta, Gluten-free pasta (not rice noodles)
const RICE_FOOD = /^(white|brown) rice$/i
const BOWL_TITLE = /(rice|bowl)/i // a rice dish by name, even with less rice (the rice has to be in the ingredients too)
/** Raw pasta or rice per serving at which the dish is built around it, rather than having a little with it. */
const PASTA_GRAMS = 40
const RICE_GRAMS = 55

/**
 * Which dish types a recipe is, worked out from its name and ingredients (so your own recipes sort too):
 * a soup is named as one; pasta is a pasta recipe or one with a real portion of pasta; a rice bowl is built on rice
 * (55 g or more raw per serving) or named as a rice dish. A soup is never a rice bowl, so a rice soup stays a soup.
 */
export function recipeDishes(recipe: Pick<Recipe, 'title' | 'category' | 'ingredients' | 'servings'>, byId: Map<number, Ingredient>): Set<DishId> {
  const dishes = new Set<DishId>()
  const servings = recipe.servings > 0 ? recipe.servings : 1
  let pasta = 0
  let rice = 0
  for (const line of recipe.ingredients) {
    const food = byId.get(line.ingredientId)
    if (!food) continue
    const grams = toGrams(line.qty, line.unit, food) ?? 0
    if (PASTA_FOOD.test(food.name)) pasta += grams
    if (RICE_FOOD.test(food.name)) rice += grams
  }
  const soup = SOUP_TITLE.test(recipe.title)
  if (soup) dishes.add('soup')
  if (recipe.category === 'Pasta' || pasta / servings >= PASTA_GRAMS) dishes.add('pasta')
  if (!soup && rice > 0 && (rice / servings >= RICE_GRAMS || BOWL_TITLE.test(recipe.title))) dishes.add('riceBowl')
  return dishes
}

// Stocks and sauces are not "a beef dish": beef broth in a stew of lentils does not make it beef.
const BEEF = /^(ground beef\b|beef (?!broth))/i
const CHICKEN = /^(chicken (breast|thigh|drumstick)|ground chicken)\b/i
const PORK = /^(pork\b|ground pork|bacon\b|ham$|chorizo\b)/i // pork cuts, plus bacon, ham, sausages and chorizo
/** Not meat on the label, but made from animals, so a recipe using them is not vegetarian. */
const HIDDEN_ANIMAL = /^(chicken broth|beef broth|bouillon cube|fish sauce|worcestershire sauce|oyster sauce|lard)/i

/**
 * Which of the quick filters a recipe belongs to, worked out from its actual ingredients (so your own recipes sort too).
 * A recipe can belong to several (chicken and bacon), but never to Vegetarian and a meat or fish group at once.
 * Vegetarian means nothing from an animal, including lard and other animal fats, stock cubes, chicken or beef stock, fish sauce, Worcestershire
 * sauce (anchovies) and oyster sauce. "Vegetable stock cube" is not told apart from other cubes, so those recipes
 * are not called vegetarian.
 */
export function recipeKinds(recipe: Pick<Recipe, 'ingredients'>, byId: Map<number, Ingredient>): Set<KindId> {
  const kinds = new Set<KindId>()
  let usesAnimal = false
  for (const line of recipe.ingredients) {
    const food = byId.get(line.ingredientId)
    if (!food) continue
    if (food.category === 'meat' || food.category === 'seafood' || HIDDEN_ANIMAL.test(food.name)) usesAnimal = true
    if (BEEF.test(food.name)) kinds.add('beef')
    if (CHICKEN.test(food.name)) kinds.add('chicken')
    if (PORK.test(food.name)) kinds.add('pork')
    if (food.category === 'seafood' && food.tags.includes('fish')) kinds.add('fish')
  }
  if (!usesAnimal && recipe.ingredients.length > 0) kinds.add('vegetarian')
  return kinds
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/-/g, ' ')
    .split(/[^a-z0-9%]+/)
    .filter(Boolean)

const singular = (w: string) => (w.endsWith('es') && w.length > 4 ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

/**
 * Does a recipe match a search? Every word typed must match something in the recipe: the start of a word in its
 * name, category or an ingredient's name ("chick" finds chicken), or a whole word of an ingredient's other names
 * ("coriander" finds Cilantro, "aubergine" finds Eggplant). Whole words for those, so "ham" does not find hamburger.
 */
export function matchesSearch(recipe: Pick<Recipe, 'title' | 'category' | 'ingredients'>, query: string, byId: Map<number, Ingredient>): boolean {
  const tokens = words(query)
  if (tokens.length === 0) return true
  const prefixWords = [...words(`${recipe.title} ${recipe.category ?? ''}`)]
  const aliasWords = new Set<string>()
  for (const line of recipe.ingredients) {
    const food = byId.get(line.ingredientId)
    if (!food) continue
    prefixWords.push(...words(food.name))
    for (const alias of food.aliases) for (const w of words(alias)) aliasWords.add(w)
  }
  return tokens.every(
    (t) => prefixWords.some((w) => w.startsWith(t) || w === singular(t)) || aliasWords.has(t) || aliasWords.has(singular(t)),
  )
}

// ---------- the whole filter set, used by every screen that searches recipes ----------

/** The "show only" choices: your chosen cuisines, or recipes you liked. Only one at a time. */
export type OnlyId = 'liked' | 'familiar'

/** Everything you can set when searching recipes. The Recipes screen and the plan's recipe picker both use exactly this. */
export interface FilterState {
  query: string
  kind: KindId | null
  dish: DishId | null
  only: OnlyId | null
  /** Sort by protein, highest first. Off means A to Z. */
  byProtein: boolean
}

export const NO_FILTERS: FilterState = { query: '', kind: null, dish: null, only: null, byProtein: false }

/** What a filter needs to know about a recipe: its kinds and dish types, its protein, and whether you can cook it. */
export interface FilterableRow {
  recipe: Pick<Recipe, 'title' | 'category' | 'ingredients' | 'rating' | 'cuisine'>
  kinds: Set<KindId>
  dishes: Set<DishId>
  nutrition: { proteinPerServing: number }
  safety: { status: string }
}

export interface FilterContext {
  byId: Map<number, Ingredient>
  preferredCuisines: string[]
}

/** Is anything narrowing the list? Sorting by protein does not count. */
export function isFiltering(state: FilterState): boolean {
  return state.kind !== null || state.dish !== null || state.only !== null || state.query.trim() !== ''
}

type Group = 'kind' | 'dish' | 'only'

/**
 * Does a recipe pass the filters that are on? `except` leaves one group out, which is how each button's number is worked
 * out: with Beef on, the Pasta number counts beef pastas, and a group's own buttons count what they would show if tapped.
 */
export function passesFilters(row: FilterableRow, state: FilterState, ctx: FilterContext, except?: Group): boolean {
  return (
    (except === 'kind' || !state.kind || row.kinds.has(state.kind)) &&
    (except === 'dish' || !state.dish || row.dishes.has(state.dish)) &&
    (except === 'only' || state.only !== 'liked' || row.recipe.rating === 'like') &&
    (except === 'only' || state.only !== 'familiar' || isPreferred(row.recipe.cuisine, ctx.preferredCuisines)) &&
    matchesSearch(row.recipe, state.query, ctx.byId)
  )
}

/** The recipes that pass, A to Z (or most protein first), with the ones you dislike at the bottom. */
export function filterRows<R extends FilterableRow>(rows: R[], state: FilterState, ctx: FilterContext): R[] {
  const matching = rows.filter((r) => passesFilters(r, state, ctx))
  const sorted = state.byProtein
    ? matching.sort((a, b) => b.nutrition.proteinPerServing - a.nutrition.proteinPerServing || a.recipe.title.localeCompare(b.recipe.title))
    : matching.sort((a, b) => a.recipe.title.localeCompare(b.recipe.title))
  // stable, so the chosen order is kept within each group
  return sorted.sort((a, b) => Number(a.recipe.rating === 'dislike') - Number(b.recipe.rating === 'dislike'))
}

/** The number on every button, over the recipes you can cook, each adjusted to the other filters that are on. */
export function filterCounts(rows: FilterableRow[], state: FilterState, ctx: FilterContext) {
  const cookable = rows.filter((r) => r.safety.status !== 'excluded')
  const count = (except: Group, has: (r: FilterableRow) => boolean) => cookable.filter((r) => passesFilters(r, state, ctx, except) && has(r)).length
  return {
    kind: Object.fromEntries(KIND_FILTERS.map((k) => [k.id, count('kind', (r) => r.kinds.has(k.id))])) as Record<KindId, number>,
    dish: Object.fromEntries(DISH_FILTERS.map((d) => [d.id, count('dish', (r) => r.dishes.has(d.id))])) as Record<DishId, number>,
    only: {
      familiar: count('only', (r) => isPreferred(r.recipe.cuisine, ctx.preferredCuisines)),
      liked: count('only', (r) => r.recipe.rating === 'like'),
    } as Record<OnlyId, number>,
  }
}

/** The filters in words for a "no results" message: "beef pasta". */
export function filterLabel(state: FilterState): string {
  return [KIND_FILTERS.find((k) => k.id === state.kind)?.label, DISH_FILTERS.find((d) => d.id === state.dish)?.label].filter(Boolean).join(' ').toLowerCase()
}
