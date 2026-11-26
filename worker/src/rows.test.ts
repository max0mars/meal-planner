import { describe, expect, it } from 'vitest'
import { RowError, fromSql, toSql } from './rows'
import { TABLES } from './tables'

describe('toSql', () => {
  it('turns app field names into columns, booleans into 0/1 and objects into JSON', () => {
    const cols = toSql(TABLES.recipes, { title: 'Soup', adhoc: true, steps: ['Boil'] }, { allowId: false })
    expect(cols).toEqual({ title: 'Soup', adhoc: 1, steps: '["Boil"]' })
  })

  it('maps renamed fields to their columns', () => {
    const cols = toSql(TABLES.mealPlan, { constraint: 'quick', eatAt: '18:30' }, { allowId: false })
    expect(cols).toEqual({ slot_constraint: 'quick', eat_at: '18:30' })
  })

  it('keeps null as NULL so a field can be cleared', () => {
    expect(toSql(TABLES.recipes, { source: null }, { allowId: false })).toEqual({ source: null })
  })

  it('leaves out undefined fields', () => {
    expect(toSql(TABLES.recipes, { title: 'x', source: undefined }, { allowId: false })).toEqual({ title: 'x' })
  })

  it('keeps the id on inserts and ignores it on updates', () => {
    expect(toSql(TABLES.trips, { id: 7, date: '2026-11-26' }, { allowId: true })).toEqual({ id: 7, date: '2026-11-26' })
    expect(toSql(TABLES.trips, { id: 7, date: '2026-11-26' }, { allowId: false })).toEqual({ date: '2026-11-26' })
  })

  it('rejects a field the table does not have', () => {
    expect(() => toSql(TABLES.trips, { nope: 1 }, { allowId: false })).toThrow(RowError)
  })

  it('rejects a value of the wrong type', () => {
    expect(() => toSql(TABLES.pantryItems, { qty: 'two' }, { allowId: false })).toThrow(/qty must be a number/)
    expect(() => toSql(TABLES.recipes, { adhoc: 'yes' }, { allowId: false })).toThrow(/adhoc must be true or false/)
    expect(() => toSql(TABLES.trips, { id: 1.5, date: 'x' }, { allowId: true })).toThrow(/whole number/)
  })

  it('never writes settings id from the body', () => {
    expect(toSql(TABLES.settings, { id: 9, kcalTarget: 2500 }, { allowId: true })).toEqual({ kcal_target: 2500 })
  })
})

describe('fromSql', () => {
  it('converts a row back to the app shape, leaving out empty fields', () => {
    const row = {
      id: 3,
      title: 'Soup',
      servings: 2,
      servings_per_meal: 1,
      ingredients: '[]',
      steps: '["Boil"]',
      est_minutes: 20,
      actual_minutes_history: '[]',
      source: null,
      seed_id: null,
      category: null,
      servings_estimated: 1,
      time_estimated: 0,
      description: null,
      cuisine: null,
      rating: 'like',
      adhoc: null,
    }
    expect(fromSql(TABLES.recipes, row)).toEqual({
      id: 3,
      title: 'Soup',
      servings: 2,
      servingsPerMeal: 1,
      ingredients: [],
      steps: ['Boil'],
      estMinutes: 20,
      actualMinutesHistory: [],
      servingsEstimated: true,
      timeEstimated: false,
      rating: 'like',
    })
  })

  it('gives the single settings row id 1', () => {
    expect(fromSql(TABLES.settings, { id: 1, kcal_target: 3000, protein_target: 150 })).toMatchObject({ id: 1, kcalTarget: 3000 })
  })

  it('round-trips a value through toSql and fromSql', () => {
    const original = { ingredientId: 4, qty: 250, unit: 'g', purchasedOn: '2026-11-20', expiresOn: '2026-11-27', location: 'fridge' }
    const sql = toSql(TABLES.pantryItems, original, { allowId: false }) as Record<string, unknown>
    const back = fromSql(TABLES.pantryItems, { id: 1, ...sql })
    expect(back).toEqual({ id: 1, ...original })
  })
})
