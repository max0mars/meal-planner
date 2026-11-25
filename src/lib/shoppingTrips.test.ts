import { describe, expect, it } from 'vitest'
import seed from '../data/ingredients.seed.json'
import type { Ingredient, MealPlanEntry, MealSlot, Recipe, Trip } from '../types'
import { cookSessions } from './plan'
import { assignToTrips, buildShoppingList } from './shopping'

const all: Ingredient[] = (seed as Ingredient[]).map((i, n) => ({ ...i, id: n + 1 }))
const byId = new Map(all.map((i) => [i.id!, i]))
const id = (name: string) => all.find((i) => i.name === name)!.id!
let nextId = 1
const recipe = (title: string, foods: string[]): Recipe & { id: number } => ({
  id: nextId++, title, servings: 1, servingsPerMeal: 1, ingredients: foods.map((f) => ({ ingredientId: id(f), qty: 200, unit: 'g' as const })),
  steps: ['Cook.'], estMinutes: 30, actualMinutesHistory: [],
})
const meal = (date: string, slot: MealSlot, r: Recipe & { id: number }): MealPlanEntry => ({ id: nextId++, date, slot, recipeId: r.id, servingsPlanned: 1, status: 'planned' })
const trip = (date: string, after: Trip['after'] = 'start'): Trip => ({ id: nextId++, date, after, time: '10:00' })

const TODAY = '2026-11-19' // Thursday
const [THU, FRI, , , MON, TUE] = ['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24']

const list = (entries: MealPlanEntry[], recipes: (Recipe & { id: number })[]) =>
  buildShoppingList(cookSessions(entries, 4), new Map(recipes.map((r) => [r.id, r])), byId, []).toBuy

describe('shopping by trip', () => {
  const stew = recipe('Stew', ['Beef chuck roast'])
  const fish = recipe('Fish', ['Salmon'])
  const curry = recipe('Curry', ['Lentils'])

  it('has no trips to sort by when none are ahead of you', () => {
    const items = list([meal(MON, 'dinner', stew)], [stew])
    expect(assignToTrips(items, [], TODAY)).toBeNull()
    expect(assignToTrips(items, [trip('2026-11-10')], TODAY)).toBeNull() // already gone
  })

  it('puts each item on the last trip before it is needed, so it is as fresh as possible', () => {
    const items = list([meal(TUE, 'dinner', stew), meal(FRI + '', 'dinner', fish)], [stew, fish])
    // trips on Thursday (today) and Monday: the Tuesday stew is bought Monday; the Friday fish is bought Thursday
    const r = assignToTrips(items, [trip(MON), trip(THU)], TODAY)!
    expect(r.groups.map((g) => [g.trip.date, g.items.map((i) => i.food.name)])).toEqual([[THU, ['Salmon']], [MON, ['Beef chuck roast']]])
    expect(r.beforeFirstTrip).toEqual([])
  })

  it('lists an item needed before the first trip on its own, so you can shop sooner or change the meal', () => {
    const items = list([meal(FRI, 'dinner', fish), meal(TUE, 'dinner', stew)], [fish, stew])
    const r = assignToTrips(items, [trip(MON)], TODAY)!
    expect(r.beforeFirstTrip.map((i) => i.food.name)).toEqual(['Salmon'])
    expect(r.groups[0].items.map((i) => i.food.name)).toEqual(['Beef chuck roast'])
  })

  it('a trip later the same day only counts if it comes before the meal', () => {
    const items = list([meal(MON, 'lunch', stew)], [stew])
    expect(assignToTrips(items, [trip(MON, 'lunch')], TODAY)!.beforeFirstTrip).toHaveLength(1) // after lunch is too late for lunch
    expect(assignToTrips(items, [trip(MON, 'start')], TODAY)!.beforeFirstTrip).toHaveLength(0)
    const dinner = list([meal(MON, 'dinner', stew)], [stew])
    expect(assignToTrips(dinner, [trip(MON, 'lunch')], TODAY)!.beforeFirstTrip).toHaveLength(0)
    expect(assignToTrips(dinner, [trip(MON, 'dinner')], TODAY)!.beforeFirstTrip).toHaveLength(1)
  })

  it('needs an ingredient by its earliest meal, even when a later meal uses it too', () => {
    const early = recipe('Lunch stew', ['Beef chuck roast'])
    const items = list([meal(MON, 'dinner', stew), meal(MON, 'lunch', early)], [stew, early])
    expect(items).toHaveLength(1)
    expect(items[0].needBySlot).toBe('lunch')
    expect(assignToTrips(items, [trip(MON, 'lunch')], TODAY)!.beforeFirstTrip).toHaveLength(1) // a trip after lunch is too late for the lunch
  })

  it('finds the earliest meal even when the cooking sessions arrive in a different order', () => {
    const early = recipe('Lunch stew', ['Beef chuck roast'])
    const sessions = cookSessions([meal(MON, 'dinner', stew), meal(MON, 'lunch', early)], 4).reverse() // dinner first
    const items = buildShoppingList(sessions, new Map([stew, early].map((r) => [r.id, r])), byId, []).toBuy
    expect(items[0].needBySlot).toBe('lunch')
  })

  it('shows every upcoming trip in order, including ones with nothing to buy', () => {
    const items = list([meal(TUE, 'dinner', curry)], [curry])
    const r = assignToTrips(items, [trip(TUE, 'dinner'), trip(MON, 'lunch'), trip(THU)], TODAY)!
    expect(r.groups.map((g) => g.trip.date + g.trip.after)).toEqual([`${THU}start`, `${MON}lunch`, `${TUE}dinner`])
    expect(r.groups[1].items.map((i) => i.food.name)).toEqual(['Lentils']) // the last trip before Tuesday dinner is Monday after lunch
    expect(r.groups[0].items).toEqual([])
  })
})
