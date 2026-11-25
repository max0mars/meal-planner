import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, MealPlannerDB, withDefaults } from './db'
import { cookSessions, dayTotals, mealNutrition } from './lib/plan'
import type { MealPlanEntry } from './types'

describe('settings with newer fields', () => {
  it('fills in meal times, quick minutes and the familiar-meals switch for settings saved by an older version', () => {
    const old = { id: 1 as const, kcalTarget: 3500, proteinTarget: 170, shoppingDays: [6], defaultLightThresholdPct: 0.1, combinedLightCapPct: 0.2, leftoverShelfLifeDays: 3 }
    const s = withDefaults(old)
    expect(s).toMatchObject({ kcalTarget: 3500, shoppingDays: [6], quickMinutes: 30, preferFamiliar: true })
    expect(s.mealTimes).toEqual({ breakfast: '08:00', lunch: '12:30', dinner: '18:30', snack: '15:30' })
  })

  it('keeps the meal times you set and fills in only the ones you did not', () => {
    const s = withDefaults({ ...DEFAULT_SETTINGS, mealTimes: { lunch: '13:15', dinner: '19:00' } as never })
    expect(s.mealTimes!.lunch).toBe('13:15')
    expect(s.mealTimes!.dinner).toBe('19:00')
    expect(s.mealTimes!.breakfast).toBe('08:00')
  })

  it('gives defaults when nothing is saved yet', () => {
    expect(withDefaults(null)).toEqual({ ...DEFAULT_SETTINGS, mealTimes: DEFAULT_SETTINGS.mealTimes })
    expect(withDefaults(undefined).planSlots).toEqual(['lunch', 'dinner'])
  })
})

describe('database version 3', () => {
  it('stores grocery trips and finds them by day', async () => {
    const db = new MealPlannerDB('foundation-trips')
    await db.trips.bulkAdd([
      { date: '2026-11-23', after: 'start', time: '11:00' },
      { date: '2026-11-23', after: 'dinner', time: '20:00', note: 'top up milk' },
      { date: '2026-11-26', after: 'lunch', time: '15:30' },
    ])
    expect((await db.trips.where('date').equals('2026-11-23').toArray()).map((t) => t.time).sort()).toEqual(['11:00', '20:00'])
    expect(await db.trips.count()).toBe(3)
  })

  it('finds a food by its barcode', async () => {
    const db = new MealPlannerDB('foundation-barcode')
    await db.ingredients.add({
      name: 'Crunchy Oat Granola', aliases: [], category: 'grains', tags: ['oats'], shelfLifeDays: { pantry: 300 },
      kcalPer100g: 450, proteinPer100g: 9, sensitivity: 'safe', custom: true, barcode: '5000112637922',
    })
    const found = await db.ingredients.where('barcode').equals('5000112637922').first()
    expect(found?.name).toBe('Crunchy Oat Granola')
    expect(await db.ingredients.where('barcode').equals('0000000000000').first()).toBeUndefined()
  })

  it('upgrades an existing database without losing anything in it', async () => {
    // a database exactly as version 2 left it, with your data in it
    const old = new Dexie('foundation-upgrade')
    old.version(2).stores({
      ingredients: '++id, name, *aliases, category, sensitivity, *tags',
      pantryItems: '++id, ingredientId, expiresOn',
      recipes: '++id, title',
      mealPlan: '++id, date, recipeId',
      leftovers: '++id, recipeId, expiresOn',
      mealLogs: '++id, date',
      settings: 'id',
      tagSensitivities: 'tag',
    })
    await old.table('ingredients').add({ name: 'My cereal', aliases: [], category: 'grains', tags: [], shelfLifeDays: { pantry: 100 }, kcalPer100g: 380, proteinPer100g: 11, sensitivity: 'light', custom: true })
    await old.table('recipes').add({ title: 'Keeper', servings: 2, servingsPerMeal: 1, ingredients: [], steps: [], estMinutes: 10, actualMinutesHistory: [] })
    await old.table('mealPlan').add({ date: '2026-11-20', slot: 'dinner', recipeId: 1, servingsPlanned: 1, status: 'planned' })
    await old.table('settings').put({ id: 1, kcalTarget: 3200, proteinTarget: 160, shoppingDays: [0], defaultLightThresholdPct: 0.15, combinedLightCapPct: 0.25, leftoverShelfLifeDays: 4 })
    old.close()

    const db = new MealPlannerDB('foundation-upgrade')
    expect((await db.ingredients.toArray()).map((i) => i.name)).toEqual(['My cereal'])
    expect((await db.recipes.toArray())[0].title).toBe('Keeper')
    expect(await db.mealPlan.count()).toBe(1)
    expect(withDefaults(await db.settings.get(1)).kcalTarget).toBe(3200) // and the new settings fall back to defaults
    await db.trips.add({ date: '2026-11-21', after: 'start', time: '10:00' })
    expect(await db.trips.count()).toBe(1)
  })
})

describe('meals with no recipe', () => {
  const entry = (over: Partial<MealPlanEntry>): MealPlanEntry => ({ id: 1, date: '2026-11-20', slot: 'dinner', servingsPlanned: 1, status: 'planned', ...over })

  it('add no calories, cook nothing, and do not break the day total', () => {
    const per = new Map([[1, { kcal: 500, protein: 40 }]])
    const out = entry({ id: 1, constraint: 'out' })
    const quick = entry({ id: 2, slot: 'lunch', constraint: 'quick' })
    const real = entry({ id: 3, slot: 'breakfast', recipeId: 1 })
    expect(mealNutrition(out, per)).toEqual({ kcal: 0, protein: 0 })
    expect(dayTotals([out, quick, real], '2026-11-20', per)).toEqual({ kcal: 500, protein: 40, meals: 3 })
    expect(cookSessions([out, quick, real], 4).map((s) => s.recipeId)).toEqual([1])
  })

  it('keep what you asked for when the planner later fills in a recipe', () => {
    const filled = entry({ recipeId: 7, constraint: 'leftovers', eatAt: '13:00' })
    expect(cookSessions([filled], 4)[0].recipeId).toBe(7)
    expect(filled).toMatchObject({ constraint: 'leftovers', eatAt: '13:00' })
  })
})

describe('recipe descriptions', () => {
  it('every starter recipe has one plain sentence and a cuisine', async () => {
    const { default: seed } = await import('./data/recipes.seed.json')
    for (const r of seed as { title: string; description?: string; cuisine?: string }[]) {
      expect(r.description, r.title).toBeTruthy()
      expect(r.description!.length, r.title).toBeGreaterThan(20)
      expect(r.description!.length, r.title).toBeLessThanOrEqual(140)
      expect(r.description, r.title).toMatch(/[.]$/)
      expect(r.description!.slice(0, -1), r.title).not.toMatch(/\. /) // one sentence
      expect(r.cuisine, r.title).toBeTruthy()
    }
  })
})
