import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../db'
import { applyPlan, changeServings, clearDays, makeDayQuick, removeMeal, removeTrip, saveTrip, setConstraint, setMeal, setTimes } from './planEdit'

afterEach(async () => {
  await db.mealPlan.clear()
  await db.trips.clear()
})

const only = async () => (await db.mealPlan.toArray())[0]

describe('editing the plan', () => {
  it('picking a meal replaces a constraint, and picking again replaces the meal', async () => {
    await setConstraint('2026-11-25', 'lunch', 'quick')
    await setMeal('2026-11-25', 'lunch', 7, 1.5)
    expect(await db.mealPlan.count()).toBe(1)
    expect(await only()).toMatchObject({ date: '2026-11-25', slot: 'lunch', recipeId: 7, servingsPlanned: 1.5, status: 'planned' })
    expect((await only()).constraint).toBeUndefined()
    await setMeal('2026-11-25', 'lunch', 9, 1)
    expect(await db.mealPlan.count()).toBe(1)
    expect((await only()).recipeId).toBe(9)
  })

  it('a constraint clears the recipe but keeps the times you set', async () => {
    await setMeal('2026-11-25', 'dinner', 7, 1)
    await setTimes((await only()).id!, { eatAt: '20:00', cookAt: '19:00' })
    await setConstraint('2026-11-25', 'dinner', 'leftovers')
    const e = await only()
    expect(e.recipeId).toBeUndefined()
    expect(e).toMatchObject({ constraint: 'leftovers', eatAt: '20:00', cookAt: '19:00' })
    expect(await db.mealPlan.count()).toBe(1)
  })

  it('eating out is one more constraint, with no recipe', async () => {
    await setConstraint('2026-11-27', 'dinner', 'out')
    expect(await only()).toMatchObject({ constraint: 'out', status: 'planned' })
  })

  it('two quick taps on the servings both count', async () => {
    await setMeal('2026-11-25', 'dinner', 7, 1)
    const id = (await only()).id!
    await Promise.all([changeServings(id, 0.5), changeServings(id, 0.5)])
    expect((await only()).servingsPlanned).toBe(2)
    await changeServings(id, -5)
    expect((await only()).servingsPlanned).toBe(0.5) // never below half a serving
  })

  it('removing a meal leaves the others', async () => {
    await setMeal('2026-11-25', 'lunch', 7, 1)
    await setMeal('2026-11-25', 'dinner', 8, 1)
    await removeMeal((await db.mealPlan.toArray())[0].id!)
    expect(await db.mealPlan.count()).toBe(1)
  })

  it('removing the meal that was cooked flags its leftovers, and removing a leftover flags nothing', async () => {
    await db.settings.put({ ...(await db.settings.get(1))!, id: 1, leftoverShelfLifeDays: 4 })
    await setMeal('2026-11-25', 'dinner', 7, 2)
    await setMeal('2026-11-26', 'dinner', 7, 1)
    await setMeal('2026-11-27', 'dinner', 7, 1)
    const byDate = async (d: string) => (await db.mealPlan.toArray()).find((e) => e.date === d)
    await removeMeal((await byDate('2026-11-27'))!.id!) // a leftover
    expect((await byDate('2026-11-26'))!.cookDeleted).toBeUndefined()
    await removeMeal((await byDate('2026-11-25'))!.id!) // the cook
    expect((await byDate('2026-11-26'))!.cookDeleted).toBe(true)
    await setMeal('2026-11-26', 'dinner', 8, 1) // picking something else clears it
    expect((await byDate('2026-11-26'))!.cookDeleted).toBeUndefined()
  })

  it('"little time today" makes empty and planner-filled meals quick, and leaves chosen, cooked and eating-out meals', async () => {
    await setMeal('2026-11-23', 'dinner', 7, 1) // chosen by you
    await setConstraint('2026-11-23', 'lunch', 'any')
    await makeDayQuick('2026-11-23', ['lunch', 'dinner'])
    const all = await db.mealPlan.toArray()
    expect(all.find((e) => e.slot === 'dinner')).toMatchObject({ recipeId: 7 })
    expect(all.find((e) => e.slot === 'dinner')!.constraint).toBeUndefined()
    expect(all.find((e) => e.slot === 'lunch')!.constraint).toBe('quick')

    await db.mealPlan.clear()
    await setConstraint('2026-11-24', 'dinner', 'out')
    await db.mealPlan.add({ date: '2026-11-24', slot: 'lunch', recipeId: 7, servingsPlanned: 1, status: 'cooked', constraint: 'any' })
    await makeDayQuick('2026-11-24', ['lunch', 'dinner', 'snack'])
    const day = await db.mealPlan.toArray()
    expect(day.find((e) => e.slot === 'dinner')!.constraint).toBe('out')
    expect(day.find((e) => e.slot === 'lunch')!.constraint).toBe('any') // already cooked
    expect(day.find((e) => e.slot === 'snack')!.constraint).toBe('quick') // an empty slot you plan
  })

  it('applying a plan adds the new meals and fills the constraint meals, keeping the constraint', async () => {
    await setConstraint('2026-11-25', 'lunch', 'leftovers')
    const id = (await only()).id!
    await applyPlan({
      add: [{ date: '2026-11-24', slot: 'dinner', recipeId: 7, servingsPlanned: 1, status: 'planned' }],
      update: [{ id, recipeId: 7, servingsPlanned: 1 }],
      unresolved: [],
    })
    const all = await db.mealPlan.toArray()
    expect(all).toHaveLength(2)
    expect(all.find((e) => e.id === id)).toMatchObject({ recipeId: 7, constraint: 'leftovers' })
  })
})

describe('grocery trips', () => {
  it('saves one trip for each place in the day, and a second for the same place replaces it', async () => {
    await saveTrip({ date: '2026-11-23', after: 'start', time: '09:00' })
    await saveTrip({ date: '2026-11-23', after: 'lunch', time: '15:00' })
    await saveTrip({ date: '2026-11-23', after: 'start', time: '10:30', note: 'big shop' })
    const trips = await db.trips.toArray()
    expect(trips).toHaveLength(2)
    expect(trips.find((t) => t.after === 'start')).toMatchObject({ time: '10:30', note: 'big shop' })
  })

  it('moving a trip to another place changes it rather than adding one', async () => {
    const id = await saveTrip({ date: '2026-11-23', after: 'start', time: '09:00' })
    await saveTrip({ date: '2026-11-23', after: 'dinner', time: '20:00' }, id)
    const trips = await db.trips.toArray()
    expect(trips).toHaveLength(1)
    expect(trips[0]).toMatchObject({ id, after: 'dinner', time: '20:00' })
  })

  it('removes a trip', async () => {
    const id = await saveTrip({ date: '2026-11-23', after: 'start', time: '09:00' })
    await removeTrip(id)
    expect(await db.trips.count()).toBe(0)
  })
})

describe('clearDays', () => {
  it('removes the planned meals and grocery trips on those days only', async () => {
    await db.mealPlan.bulkAdd([
      { date: '2026-11-23', slot: 'lunch', recipeId: 1, servingsPlanned: 1, status: 'planned' },
      { date: '2026-11-23', slot: 'dinner', servingsPlanned: 1, status: 'planned', constraint: 'out' },
      { date: '2026-11-24', slot: 'dinner', recipeId: 1, servingsPlanned: 1, status: 'planned' },
      { date: '2026-11-25', slot: 'dinner', recipeId: 1, servingsPlanned: 1, status: 'planned' },
    ])
    await db.trips.bulkAdd([
      { date: '2026-11-23', after: 'start', time: '10:00' },
      { date: '2026-11-24', after: 'lunch', time: '15:30' },
      { date: '2026-11-25', after: 'start', time: '10:00' },
    ])
    await clearDays(['2026-11-23', '2026-11-24'])
    expect((await db.mealPlan.toArray()).map((e) => e.date)).toEqual(['2026-11-25'])
    expect((await db.trips.toArray()).map((t) => t.date)).toEqual(['2026-11-25'])
  })

  it('leaves a meal already cooked, which is history, and does nothing for an empty list', async () => {
    await db.mealPlan.add({ date: '2026-11-23', slot: 'dinner', recipeId: 1, servingsPlanned: 1, status: 'cooked' })
    await clearDays(['2026-11-23'])
    expect(await db.mealPlan.count()).toBe(1)
    await clearDays([])
    expect(await db.mealPlan.count()).toBe(1)
  })
})
