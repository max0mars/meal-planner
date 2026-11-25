import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../db'
import type { MealPlanEntry, PantryItem } from '../types'
import { itemsToUseSoon, todaysMeals } from './today'

const TIMES = DEFAULT_SETTINGS.mealTimes! // breakfast 08:00, lunch 12:30, dinner 18:30, snack 15:30
const DAY = '2026-11-21'
const entry = (slot: MealPlanEntry['slot'], over: Partial<MealPlanEntry> = {}): MealPlanEntry => ({ id: 1, date: DAY, slot, recipeId: 1, servingsPlanned: 1, status: 'planned', ...over })
const at = (h: number, m = 0) => h * 60 + m

describe('todaysMeals', () => {
  it('lists the meals you plan in the order you eat them, with the first one still to come as next', () => {
    const meals = todaysMeals([entry('dinner'), entry('lunch', { id: 2 })], DAY, ['lunch', 'dinner'], TIMES, at(9))
    expect(meals.map((m) => [m.slot, m.state])).toEqual([['lunch', 'next'], ['dinner', 'later']])
  })

  it('marks meals whose time has gone as earlier, and moves next along', () => {
    const entries = [entry('lunch'), entry('dinner', { id: 2 })]
    expect(todaysMeals(entries, DAY, ['lunch', 'dinner'], TIMES, at(13)).map((m) => m.state)).toEqual(['past', 'next'])
    expect(todaysMeals(entries, DAY, ['lunch', 'dinner'], TIMES, at(12, 30)).map((m) => m.state)).toEqual(['next', 'later']) // at the time itself it is still next
    expect(todaysMeals(entries, DAY, ['lunch', 'dinner'], TIMES, at(21)).map((m) => m.state)).toEqual(['past', 'past']) // nothing left
  })

  it('shows a meal you plan even when nothing is chosen for it', () => {
    const meals = todaysMeals([entry('dinner')], DAY, ['lunch', 'dinner'], TIMES, at(9))
    expect(meals[0]).toMatchObject({ slot: 'lunch', entry: undefined })
    expect(meals[1].entry).toBeTruthy()
  })

  it('includes a meal you have not turned on if something is planned for it, and leaves out skipped meals and other days', () => {
    const entries = [entry('snack', { id: 2 }), entry('lunch', { id: 3, status: 'skipped' }), entry('dinner', { id: 4, date: '2026-11-22' })]
    const meals = todaysMeals(entries, DAY, ['lunch', 'dinner'], TIMES, at(9))
    expect(meals.map((m) => m.slot)).toEqual(['lunch', 'snack', 'dinner']) // a snack is at 3:30 PM, between the other two
    expect(meals[0].entry).toBeUndefined() // the skipped lunch counts as nothing planned
    expect(meals[2].entry).toBeUndefined() // dinner is planned for another day
  })

  it('uses the time set on a meal, so a late lunch goes after a snack', () => {
    const meals = todaysMeals([entry('lunch', { eatAt: '16:00' }), entry('snack', { id: 2 })], DAY, ['lunch', 'snack'], TIMES, at(9))
    expect(meals.map((m) => [m.slot, m.time])).toEqual([['snack', '15:30'], ['lunch', '16:00']])
  })
})

describe('itemsToUseSoon', () => {
  const item = (id: number, expiresOn: string): PantryItem => ({ id, ingredientId: 1, qty: 1, unit: 'g', purchasedOn: '2026-11-01', expiresOn, location: 'fridge' })

  it('keeps food past its date or going off within three days, soonest first', () => {
    const items = [item(1, '2026-11-30'), item(2, '2026-11-24'), item(3, '2026-11-19'), item(4, '2026-11-25'), item(5, '2026-11-21')]
    expect(itemsToUseSoon(items, DAY).map((i) => i.id)).toEqual([3, 5, 2]) // 25 Nov is 4 days away
  })

  it('is empty when nothing is about to go off', () => {
    expect(itemsToUseSoon([item(1, '2026-12-25')], DAY)).toEqual([])
  })
})
