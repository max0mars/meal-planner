import { db, ensureSettings, type MealPlannerDB } from '../db'
import type { Ingredient, Recipe, Unit } from '../types'
import { legacyServingsGuess } from './guessServings'
import { recipeNutrition } from './nutrition'
import { SEED_FIXES, type FixLine } from './seedFixes'

/**
 * Bump when recipes.seed.json gains recipes or corrections. Existing installs then receive only what is new.
 * 1: first release (servings guessed as calories / 600).
 * 2: servings guessed from the kind of dish and marked as a guess; first-release guesses are corrected.
 * 3: servings and times published by the original recipe pages replace the guesses wherever they were found.
 * 4: every recipe has a one-sentence description and a cuisine; existing recipes get them only where they have none.
 * 5: plain everyday recipes added (bowls, pastas, a protein with rice and vegetables, simple breakfasts).
 * 6: dessert recipes removed; installed baseline desserts are deleted unless they are on your plan.
 * 7: ingredient amounts corrected on the piri-piri chicken.
 * 8: ingredient amounts and servings corrected on recipes whose import misread them (see SEED_FIXES); only recipes still as shipped.
 * 9: more corrections, for every recipe whose page publishes servings and nutrition.
 */
export const BASELINE_RECIPES_VERSION = 9

interface SeedRecipe {
  seedId: string
  title: string
  description?: string
  cuisine?: string
  category: string | null
  source: string
  servings: number
  /** False when `servings` is what the original recipe published. */
  servingsEstimated?: boolean
  estMinutes: number
  /** False when `estMinutes` is what the original recipe published. */
  timeEstimated?: boolean
  ingredients: { name: string; qty: number; unit: Unit }[]
  steps: string[]
}

/**
 * Release 1 guessed servings as calories / 600, which made every recipe look like about 600 kcal a serving.
 * If a stored recipe still has exactly that guess, replace it with the better one. If it differs, you changed it
 * yourself, so keep your number and just stop calling it a guess.
 */
async function correctFirstReleaseServings(database: MealPlannerDB, seed: SeedRecipe[], byId: Map<number, Ingredient>) {
  const seedById = new Map(seed.map((s) => [s.seedId, s]))
  for (const r of await database.recipes.toArray()) {
    if (!r.seedId || r.servingsEstimated !== undefined) continue
    const fresh = seedById.get(r.seedId)
    if (!fresh) continue
    const stillTheOldGuess = r.servings === legacyServingsGuess(recipeNutrition({ ...r, servings: 1 }, byId).totalKcal)
    await database.recipes.update(r.id!, stillTheOldGuess ? { servings: fresh.servings, servingsEstimated: true } : { servingsEstimated: false })
  }
}

/**
 * Corrects starter recipes whose import was wrong (see SEED_FIXES). A change is only made to a recipe that still has what
 * shipped: ingredient lines that are not exactly as they were, or servings you have changed, are left as you made them.
 */
async function applySeedFixes(database: MealPlannerDB, idByName: Map<string, number>) {
  const toLine = (l: FixLine) => ({ ingredientId: idByName.get(l.name), qty: l.qty, unit: l.unit })
  for (const fix of SEED_FIXES) {
    for (const r of await database.recipes.filter((x) => x.seedId === fix.seedId).toArray()) {
      const changes: Partial<Recipe> = {}
      let ingredients = r.ingredients
      if (fix.was && fix.now) {
        const was = fix.was.map(toLine)
        const now = fix.now.map(toLine)
        const at = was.map((w) => ingredients.findIndex((l) => l.ingredientId === w.ingredientId && l.qty === w.qty && l.unit === w.unit))
        if (!at.some((i) => i < 0) && !now.some((l) => l.ingredientId == null)) {
          ingredients = ingredients.map((l, i) => (at.includes(i) ? now[at.indexOf(i)] : l)) as Recipe['ingredients']
        }
      }
      for (const add of (fix.add ?? []).map(toLine)) {
        if (add.ingredientId != null && !ingredients.some((l) => l.ingredientId === add.ingredientId)) ingredients = [...ingredients, add] as Recipe['ingredients']
      }
      const dropIds = (fix.drop ?? []).map((n) => idByName.get(n))
      if (dropIds.length > 0) {
        const kept = ingredients.filter((l) => !dropIds.includes(l.ingredientId))
        if (kept.length !== ingredients.length) ingredients = kept
      }
      if (ingredients !== r.ingredients) changes.ingredients = ingredients
      if (fix.servings && r.servings === fix.servings.was) {
        changes.servings = fix.servings.now
        changes.servingsEstimated = fix.servings.estimated
      }
      if (Object.keys(changes).length > 0) await database.recipes.update(r.id!, changes)
    }
  }
}

/** Desserts that shipped with the app are removed from installs that already have them, unless a meal in your plan uses one. */
async function removeBaselineDesserts(database: MealPlannerDB) {
  const planned = new Set((await database.mealPlan.toArray()).map((e) => e.recipeId))
  const gone = (await database.recipes.toArray()).filter((r) => r.seedId && r.category === 'Dessert' && !planned.has(r.id!))
  if (gone.length > 0) await database.recipes.bulkDelete(gone.map((r) => r.id!))
}

/** The placeholder time every starter recipe had before times were taken from the original pages. */
const PLACEHOLDER_MINUTES = 45

/**
 * Where the original page published servings or a time, use that. Only recipes still showing the app's own guess
 * are touched: a servings number you set (the flag is then false) or a time you changed is left exactly as it is.
 */
async function refreshFromSources(database: MealPlannerDB, seed: SeedRecipe[]) {
  const seedById = new Map(seed.map((s) => [s.seedId, s]))
  for (const r of await database.recipes.toArray()) {
    const fresh = r.seedId ? seedById.get(r.seedId) : undefined
    if (!fresh) continue
    const changes: Partial<Recipe> = {}
    if (r.servingsEstimated === true && fresh.servingsEstimated === false) {
      changes.servings = fresh.servings
      changes.servingsEstimated = false
    }
    if (r.timeEstimated !== false && r.estMinutes === PLACEHOLDER_MINUTES && fresh.timeEstimated === false) {
      changes.estMinutes = fresh.estMinutes
      changes.timeEstimated = false
    }
    // Descriptions and cuisines are only ever filled in where missing: text you wrote yourself is never replaced.
    if (!r.description && fresh.description) changes.description = fresh.description
    if (!r.cuisine && fresh.cuisine) changes.cuisine = fresh.cuisine
    if (Object.keys(changes).length > 0) await database.recipes.update(r.id!, changes)
  }
}

/**
 * Adds the baseline recipes (from TheMealDB) once per release. Ingredients are stored by name in the
 * seed file and looked up here, because database ids differ between installs. Every seedId ever added is
 * remembered, so a recipe you delete is never brought back, and one you edit is left alone: later releases
 * only add recipes this install has not seen before.
 */
export async function seedBaselineRecipes(database: MealPlannerDB = db): Promise<number> {
  const settings = await ensureSettings(database)
  if ((settings.baselineRecipesVersion ?? 0) >= BASELINE_RECIPES_VERSION) return 0

  const { default: seedJson } = await import('../data/recipes.seed.json')
  const seed = seedJson as SeedRecipe[]
  const ingredients = await database.ingredients.toArray()
  const idByName = new Map(ingredients.map((i) => [i.name, i.id!]))
  const byId = new Map(ingredients.map((i) => [i.id!, i]))

  const installed = settings.baselineRecipesVersion ?? 0
  if (installed >= 1 && installed < 6) await removeBaselineDesserts(database)
  if (installed >= 1 && installed < 9) await applySeedFixes(database, idByName)
  if (installed === 1) await correctFirstReleaseServings(database, seed, byId)
  if (installed >= 1) await refreshFromSources(database, seed)

  // Everything ever added (even if since deleted), plus anything already in the table.
  const seen = new Set<string | undefined>([...(settings.baselineSeedIds ?? []), ...(await database.recipes.toArray()).map((r) => r.seedId)])

  const toAdd: Recipe[] = []
  for (const r of seed) {
    if (seen.has(r.seedId)) continue
    const lines = r.ingredients.map((l) => ({ ingredientId: idByName.get(l.name), qty: l.qty, unit: l.unit }))
    // Never add a recipe with an ingredient we cannot find: it would hide that ingredient from the sensitivity check.
    if (lines.some((l) => l.ingredientId == null)) continue
    toAdd.push({
      title: r.title,
      servings: r.servings,
      servingsEstimated: r.servingsEstimated ?? true,
      servingsPerMeal: 1,
      ingredients: lines as Recipe['ingredients'],
      steps: r.steps,
      estMinutes: r.estMinutes,
      timeEstimated: r.timeEstimated ?? true,
      actualMinutesHistory: [],
      source: r.source,
      seedId: r.seedId,
      category: r.category ?? undefined,
      description: r.description,
      cuisine: r.cuisine,
    })
  }
  if (toAdd.length > 0) await database.recipes.bulkAdd(toAdd)
  const everAdded = [...new Set([...(settings.baselineSeedIds ?? []), ...toAdd.map((r) => r.seedId!)])]
  await database.settings.update(1, { baselineRecipesVersion: BASELINE_RECIPES_VERSION, baselineSeedIds: everAdded })
  return toAdd.length
}
