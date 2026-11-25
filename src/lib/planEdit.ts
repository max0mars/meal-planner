import { db } from '../db'
import type { MealPlanEntry, MealSlot, SlotConstraint, Trip } from '../types'
import type { PlanResult } from './planner'
import { cookSessions } from './plan'

// Every change reads the stored meal and writes it back in one transaction, so quick taps run one after the other and
// all count, instead of the second overwriting the first with a stale copy.

const find = (date: string, slot: MealSlot) =>
  db.mealPlan
    .where('date')
    .equals(date)
    .filter((e) => e.slot === slot)
    .first()

/** A meal you picked yourself. It replaces any constraint, and the planner leaves it alone. */
export function setMeal(date: string, slot: MealSlot, recipeId: number, servingsPlanned: number) {
  return db.transaction('rw', db.mealPlan, async () => {
    const existing = await find(date, slot)
    const fields = { recipeId, servingsPlanned, status: 'planned' as const, constraint: undefined, cookDeleted: undefined }
    if (existing?.id != null) await db.mealPlan.update(existing.id, fields)
    else await db.mealPlan.add({ date, slot, ...fields })
  })
}

/**
 * "Leftovers", "Eating out", "Quick" or "Let the planner choose" for a meal. The recipe is cleared: "Plan these days" fills it
 * in (or "Eating out" needs none). Your chosen times are kept.
 */
export function setConstraint(date: string, slot: MealSlot, constraint: SlotConstraint) {
  return db.transaction('rw', db.mealPlan, async () => {
    const existing = await find(date, slot)
    const fields = { constraint, recipeId: undefined, status: 'planned' as const, cookDeleted: undefined }
    if (existing?.id != null) await db.mealPlan.update(existing.id, fields)
    else await db.mealPlan.add({ date, slot, servingsPlanned: 1, ...fields })
  })
}

/**
 * Flags the leftovers of any meal about to be deleted: the later meals of the same cook, which lose the food they were
 * going to eat. Must run inside a transaction on mealPlan (and settings), before the delete.
 */
async function flagLeftoversOf(ids: Set<number>) {
  const windowDays = (await db.settings.get(1))?.leftoverShelfLifeDays ?? 4
  const sessions = cookSessions(await db.mealPlan.toArray(), windowDays)
  for (const s of sessions) {
    const cook = s.entries[0]
    if (cook.id == null || !ids.has(cook.id)) continue
    for (const e of s.entries.slice(1)) {
      if (e.id != null && !ids.has(e.id)) await db.mealPlan.update(e.id, { cookDeleted: true })
    }
  }
}

export function removeMeal(id: number) {
  return db.transaction('rw', db.mealPlan, db.settings, async () => {
    await flagLeftoversOf(new Set([id]))
    await db.mealPlan.delete(id)
  })
}

/** Dismisses the "cook was deleted" flag on a meal. */
export function dismissCookDeleted(id: number) {
  return db.mealPlan.update(id, { cookDeleted: undefined })
}

/** Set when you eat a meal, and/or when you start cooking it. `undefined` goes back to the usual or worked-out time. */
export function setTimes(id: number, times: Partial<Pick<MealPlanEntry, 'eatAt' | 'cookAt'>>) {
  return db.mealPlan.update(id, times)
}

export function changeServings(id: number, delta: number) {
  return db.transaction('rw', db.mealPlan, async () => {
    const latest = await db.mealPlan.get(id)
    if (latest) await db.mealPlan.update(id, { servingsPlanned: Math.max(0.5, Math.round((latest.servingsPlanned + delta) * 2) / 2) })
  })
}

/**
 * "Little time today": every meal you have not picked yourself becomes a quick one. A meal you chose, or one already
 * cooked or skipped, is left alone, and so is a meal out.
 */
export function makeDayQuick(date: string, slots: MealSlot[]) {
  return db.transaction('rw', db.mealPlan, async () => {
    for (const slot of slots) {
      const existing = await find(date, slot)
      if (!existing) await db.mealPlan.add({ date, slot, servingsPlanned: 1, status: 'planned', constraint: 'quick' })
      else if (existing.status === 'planned' && existing.constraint && existing.constraint !== 'out') {
        await db.mealPlan.update(existing.id!, { constraint: 'quick', recipeId: undefined })
      }
    }
  })
}

/**
 * Empties some days: the meals planned on them and the grocery trips set for them. A meal already cooked or skipped is left,
 * since it is history rather than a plan.
 */
export function clearDays(dates: string[]) {
  const wanted = new Set(dates)
  return db.transaction('rw', db.mealPlan, db.trips, db.settings, async () => {
    const meals = (await db.mealPlan.toArray()).filter((e) => wanted.has(e.date) && e.status === 'planned')
    const trips = (await db.trips.toArray()).filter((t) => wanted.has(t.date))
    await flagLeftoversOf(new Set(meals.map((e) => e.id!)))
    await db.mealPlan.bulkDelete(meals.map((e) => e.id!))
    await db.trips.bulkDelete(trips.map((t) => t.id!))
  })
}

/** One grocery trip for each place in the day: saving a second one for the same place replaces the first. */
export function saveTrip(trip: Omit<Trip, 'id'>, replaceId?: number) {
  return db.transaction('rw', db.trips, async () => {
    const same = (await db.trips.where('date').equals(trip.date).toArray()).find((t) => t.after === trip.after)
    const id = replaceId ?? same?.id
    if (id != null) {
      await db.trips.put({ ...trip, id })
      return id
    }
    return (await db.trips.add(trip)) as number
  })
}

export function removeTrip(id: number) {
  return db.trips.delete(id)
}

/** Writes what `planWeek` worked out: new meals, and recipes for the meals that had a constraint. */
export function applyPlan(result: PlanResult) {
  return db.transaction('rw', db.mealPlan, async () => {
    if (result.add.length > 0) await db.mealPlan.bulkAdd(result.add)
    for (const u of result.update) await db.mealPlan.update(u.id, { recipeId: u.recipeId, servingsPlanned: u.servingsPlanned })
  })
}
