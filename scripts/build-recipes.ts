// Builds src/data/recipes.seed.json from a folder of TheMealDB JSON files (search.php?f=a ... z).
// Usage: npx tsx scripts/build-recipes.ts <folder-with-json> [--report]
//
// A recipe is kept only if EVERY ingredient resolves to one of our foods with a usable amount.
// Dropping an unknown ingredient would hide it from the sensitivity check, so such recipes are left out.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cuisineLabel, isFamiliar } from '../src/lib/cuisine'
import { guessServings } from '../src/lib/guessServings'
import { mergeDuplicateLines } from '../src/lib/mergeLines'
import { recipeNutrition } from '../src/lib/nutrition'
import { parseIngredientLine, type ParsedLine } from '../src/lib/parseIngredients'
import type { Ingredient } from '../src/types'

const here = dirname(fileURLToPath(import.meta.url))
const dir = process.argv[2]
if (!dir) {
  console.error('Usage: npx tsx scripts/build-recipes.ts <folder> [--report]')
  process.exit(1)
}
const report = process.argv.includes('--report')

const foods = (JSON.parse(readFileSync(join(here, '..', 'src', 'data', 'ingredients.seed.json'), 'utf8')) as Ingredient[]).map(
  (f, i) => ({ ...f, id: i + 1 }),
)

interface Meal {
  idMeal: string
  strMeal: string
  strCategory: string | null
  strArea?: string | null
  strCountry?: string | null
  strInstructions: string | null
  strSource: string | null
  [key: string]: string | null
}

const meals: Meal[] = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => (JSON.parse(readFileSync(join(dir, f), 'utf8')).meals ?? []) as Meal[])

/** Steps from the free-text instructions: one per paragraph, with "step 1" style labels removed. */
function toSteps(text: string | null): string[] {
  return (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(step\s*\d+|\d+[.)]?)$/i.test(l))
}

// Servings and minutes published by each source page, if scripts/fetch-yields.ts has been run.
const yieldsFile = join(here, 'data', 'source-yields.json')
const yields: Record<string, { servings: number; minutes?: number }> = existsSync(yieldsFile)
  ? JSON.parse(readFileSync(yieldsFile, 'utf8'))
  : {}

// One plain sentence per recipe, written by hand (the source has none). A recipe without one is reported below.
const descriptionsFile = join(here, 'data', 'recipe-descriptions.json')
const descriptions: Record<string, string> = existsSync(descriptionsFile) ? JSON.parse(readFileSync(descriptionsFile, 'utf8')) : {}

const foodByName = new Map(foods.map((f) => [f.name, f]))
const foodById = new Map(foods.map((f) => [f.id, f]))
const noWeight = new Map<string, number>()
const audit = new Map<string, number>()
const unmatched = new Map<string, number>()
const loose = new Map<string, number>()
const kept: unknown[] = []
let dropped = 0

// --familiar: only look at (and report on) everyday western recipes, to see what blocks the ones people would cook
const familiarOnly = process.argv.includes('--familiar')
const onlyCuisine = process.argv.find((a) => a.startsWith('--cuisine='))?.slice('--cuisine='.length)
if ((familiarOnly || onlyCuisine) && !report && !process.argv.includes('--audit')) {
  console.error('--familiar is only for --report or --audit. Writing the seed with it would drop every other recipe.')
  process.exit(1)
}

for (const m of meals) {
  const cuisine = cuisineLabel(m.strArea ?? m.strCountry)
  if (familiarOnly && !isFamiliar(cuisine)) continue
  if (onlyCuisine && cuisine !== onlyCuisine) continue
  const lines: ParsedLine[] = []
  for (let i = 1; i <= 20; i++) {
    const name = m[`strIngredient${i}`]?.trim()
    const measure = m[`strMeasure${i}`]?.trim() ?? ''
    if (!name) continue
    lines.push(parseIngredientLine(`${measure} ${name}`.trim(), foods))
  }
  const bad = lines.filter((l) => !l.match || l.qty == null || !(l.qty > 0) || /Couldn't estimate/.test(l.note))
  const fuzzy = lines.filter((l) => l.match && /loosely|several options/.test(l.note))
  for (const l of bad) unmatched.set(l.text || l.source, (unmatched.get(l.text || l.source) ?? 0) + 1)
  for (const l of fuzzy) loose.set(`${l.text} -> ${l.match!.name}`, (loose.get(`${l.text} -> ${l.match!.name}`) ?? 0) + 1)
  const steps = toSteps(m.strInstructions)
  if (lines.length === 0 || bad.length > 0 || fuzzy.length > 0 || steps.length === 0) {
    dropped++
    continue
  }
  // Every amount must convert to grams, or its calories would silently count as zero.
  // A food named on two lines ("smoked haddock" and "haddock") is one ingredient, so combine them.
  const merged = mergeDuplicateLines(
    lines.map((l) => ({ ingredientId: foodByName.get(l.match!.name)!.id!, qty: l.qty!, unit: l.unit })),
    foodById,
  )
  const probe = { servings: 1, ingredients: merged }
  const nutrition = recipeNutrition(probe, foodById)
  if (nutrition.uncounted.length > 0) {
    noWeight.set(nutrition.uncounted[0].name, (noWeight.get(nutrition.uncounted[0].name) ?? 0) + 1)
    dropped++
    continue
  }
  const published = yields[`themealdb:${m.idMeal}`]
  for (const l of lines) {
    const key = `${l.text}  =>  ${l.match!.name}`
    if (l.text.toLowerCase() !== l.match!.name.toLowerCase()) audit.set(key, (audit.get(key) ?? 0) + 1)
  }
  kept.push({
    seedId: `themealdb:${m.idMeal}`,
    title: m.strMeal,
    category: m.strCategory,
    cuisine,
    description: descriptions[`themealdb:${m.idMeal}`],
    source: m.strSource || `https://www.themealdb.com/meal/${m.idMeal}`,
    // TheMealDB has no servings or timing. Use what the source page published (scripts/fetch-yields.ts) when we have
    // it, and otherwise a guess (see guessServings) and 45 minutes, marked as guesses.
    servings: published?.servings ?? guessServings(m.strCategory, nutrition.totalKcal),
    servingsEstimated: !published?.servings,
    estMinutes: published?.minutes ?? 45,
    timeEstimated: !published?.minutes,
    ingredients: merged.map((l) => ({ name: foodById.get(l.ingredientId)!.name, qty: l.qty, unit: l.unit })),
    steps,
  })
}

const top =(map: Map<string, number>, n: number) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
console.log(`Meals fetched: ${meals.length}. Fully resolved: ${kept.length}. Left out: ${dropped}.`)
if (process.argv.includes('--audit')) {
  console.log('\nHow wording was matched in KEPT recipes (wording => food), for checking:')
  for (const [k, n] of [...audit.entries()].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`${String(n).padStart(3)}  ${k}`)
} else if (report) {
  console.log('\nMost common unresolved ingredients (recipes blocked):')
  for (const [k, n] of top(unmatched, 60)) console.log(`${String(n).padStart(4)}  ${k}`)
  console.log('\nMost common loose matches (recipes blocked):')
  for (const [k, n] of top(loose, 25)) console.log(`${String(n).padStart(4)}  ${k}`)
  console.log('\nFoods with an amount that has no known weight (recipes blocked):')
  for (const [k, n] of top(noWeight, 15)) console.log(`${String(n).padStart(4)}  ${k}`)
} else {
  writeFileSync(join(here, '..', 'src', 'data', 'recipes.seed.json'), JSON.stringify(kept, null, 1))
  console.log(`Wrote ${kept.length} recipes to src/data/recipes.seed.json`)
}
