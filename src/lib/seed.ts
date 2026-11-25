import { db, ensureSettings, type MealPlannerDB } from '../db'
import type { Ingredient } from '../types'

/** Reference data that can be filled in on existing installs. Never touches user-set fields like sensitivity. */
const BACKFILL_FIELDS = ['gramsPerPiece', 'gramsPerMl', 'tags', 'shelfLifeDays'] as const

/**
 * Loads the bundled ingredient list. Adds any ingredient (matched by name) that is
 * missing, and fills in newly added reference data (unit conversions) on existing ones,
 * so new releases appear without touching foods you have already labelled or edited.
 * Safe to call on every start.
 */
export async function seedIfEmpty(database: MealPlannerDB = db): Promise<void> {
  await ensureSettings(database)
  const { default: seed } = await import('../data/ingredients.seed.json')
  const existing = new Map((await database.ingredients.toArray()).map((i) => [i.name, i]))

  const missing: Ingredient[] = []
  for (const s of seed as Ingredient[]) {
    const have = existing.get(s.name)
    if (!have) {
      missing.push(s)
      continue
    }
    const patch: Partial<Ingredient> = {}
    for (const f of BACKFILL_FIELDS) {
      if (have[f] === undefined && s[f] !== undefined) (patch as Record<string, unknown>)[f] = s[f]
    }
    if (Object.keys(patch).length > 0) await database.ingredients.update(have.id!, patch)
  }
  if (missing.length > 0) await database.ingredients.bulkAdd(missing)

  // Early versions stored a 15% Light-food limit on every food. There was no way to change it per food, so any
  // food still holding exactly that value just means "use the default", which Settings now controls.
  await database.ingredients
    .filter((i) => i.lightThresholdPct === 0.15)
    .modify((i) => {
      delete i.lightThresholdPct
    })
}
