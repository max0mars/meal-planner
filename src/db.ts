import Dexie, { type EntityTable } from 'dexie'
import { DEFAULT_REGIONS, normalizeRegions } from './lib/cuisine'
import type {
  Ingredient,
  Leftover,
  MealLog,
  MealPlanEntry,
  PantryItem,
  Recipe,
  Settings,
  TagSensitivity,
  Trip,
} from './types'

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

export class MealPlannerDB extends Dexie {
  ingredients!: EntityTable<Ingredient, 'id'>
  pantryItems!: EntityTable<PantryItem, 'id'>
  recipes!: EntityTable<Recipe, 'id'>
  mealPlan!: EntityTable<MealPlanEntry, 'id'>
  leftovers!: EntityTable<Leftover, 'id'>
  mealLogs!: EntityTable<MealLog, 'id'>
  settings!: EntityTable<Settings, 'id'>
  trips!: EntityTable<Trip, 'id'>
  tagSensitivities!: EntityTable<TagSensitivity, 'tag'>

  constructor(name = 'meal-planner') {
    super(name)
    this.version(1).stores({
      ingredients: '++id, name, *aliases, category, sensitivity',
      pantryItems: '++id, ingredientId, expiresOn',
      recipes: '++id, title',
      mealPlan: '++id, date, recipeId',
      leftovers: '++id, recipeId, expiresOn',
      mealLogs: '++id, date',
      settings: 'id',
    })
    // v2: curated ingredient list + allergen/intolerance tags. The ingredient table is
    // cleared so it reseeds from the new curated list (no recipes/pantry existed yet).
    this.version(2)
      .stores({
        ingredients: '++id, name, *aliases, category, sensitivity, *tags',
        tagSensitivities: 'tag',
      })
      .upgrade((tx) => tx.table('ingredients').clear())
    // v3: grocery trips, and a barcode on foods you add by scanning. No data needs changing.
    this.version(3).stores({
      ingredients: '++id, name, *aliases, category, sensitivity, *tags, barcode',
      trips: '++id, date',
    })
  }
}

export const db = new MealPlannerDB()

export async function ensureSettings(database: MealPlannerDB = db): Promise<Settings> {
  const existing = await database.settings.get(1)
  if (existing) return existing
  await database.settings.put(DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}
