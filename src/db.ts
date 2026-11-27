import { DEFAULT_REGIONS, normalizeRegions } from './lib/cuisine'
import { createTable, runTransaction, type Table } from './api/table'
import type { Ingredient, Leftover, MealLog, MealPlanEntry, PantryItem, Recipe, Settings, TagSensitivity, Trip } from './types'

export const DEFAULT_SETTINGS: Settings = {
  id: 1,
  kcalTarget: 3000,
  proteinTarget: 150,
  defaultLightThresholdPct: 0.15,
  combinedLightCapPct: 0.25,
  leftoverShelfLifeDays: 4,
  planSlots: ['lunch', 'dinner'],
  mealTimes: { breakfast: '08:00', lunch: '12:30', dinner: '18:30', snack: '15:30' },
  quickMinutes: 30,
  preferFamiliar: true,
  preferredCuisines: DEFAULT_REGIONS,
  timeFormat: '12h',
}

/** Settings after defaults: the fields added in later versions are always present. */
export type ResolvedSettings = Settings & Required<Pick<Settings, 'mealTimes' | 'quickMinutes' | 'preferFamiliar' | 'preferredCuisines' | 'timeFormat'>>

/** Stored settings with any newer fields filled in from the defaults, so old installs keep working. */
export function withDefaults(stored?: Settings | null): ResolvedSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(stored ?? {}) }
  // a saved set of meal times that is missing one (from an older version) keeps the usual time for that meal
  // An install from before the cuisine setting had the on/off switch: on becomes the usual western regions, off becomes none.
  // One that saved single cuisines ("Italian") has them as their regions now.
  const preferredCuisines = stored?.preferredCuisines ? normalizeRegions(stored.preferredCuisines) : stored?.preferFamiliar === false ? [] : DEFAULT_REGIONS
  return {
    ...merged,
    preferredCuisines,
    preferFamiliar: preferredCuisines.length > 0,
    mealTimes: { ...DEFAULT_SETTINGS.mealTimes!, ...(stored?.mealTimes ?? {}) },
  } as ResolvedSettings
}

/** The planner's data. Same tables and methods as before, now kept on the Worker (see src/api/). */
export class MealPlannerDB {
  /** The schema version the backup file records. Kept at the last Dexie version so older backups still restore. */
  readonly verno = 3

  readonly ingredients: Table<Ingredient> = createTable<Ingredient>('ingredients')
  readonly pantryItems: Table<PantryItem> = createTable<PantryItem>('pantryItems')
  readonly recipes: Table<Recipe> = createTable<Recipe>('recipes')
  readonly mealPlan: Table<MealPlanEntry> = createTable<MealPlanEntry>('mealPlan')
  readonly leftovers: Table<Leftover> = createTable<Leftover>('leftovers')
  readonly mealLogs: Table<MealLog> = createTable<MealLog>('mealLogs')
  readonly settings: Table<Settings> = createTable<Settings>('settings')
  readonly trips: Table<Trip> = createTable<Trip>('trips')
  readonly tagSensitivities: Table<TagSensitivity> = createTable<TagSensitivity>('tagSensitivities')

  table(name: string): Table<Record<string, unknown>> {
    const t = (this as unknown as Record<string, unknown>)[name]
    if (!t || typeof t !== 'object') throw new Error(`No table called "${name}"`)
    return t as Table<Record<string, unknown>>
  }

  /**
   * Runs `work` as one transaction: every change it makes to the planner's data is saved together, or none is. See
   * runTransaction in src/api/table.ts.
   */
  transaction<T>(_mode: string, ...rest: [...unknown[], () => Promise<T>]): Promise<T> {
    const work = rest[rest.length - 1] as () => Promise<T>
    return runTransaction(work)
  }
}

export const db = new MealPlannerDB()

export async function ensureSettings(database: MealPlannerDB = db): Promise<Settings> {
  const existing = await database.settings.get(1)
  if (existing) return existing
  await database.settings.put(DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}
