import { db } from '../db'
import type { Ingredient, MealPlanEntry, MealSlot, Recipe, RecipeIngredient, SlotConstraint, Trip } from '../types'
import type { PlanResult } from './planner'
import { cookSessions } from './plan'
import { takeFromPantry } from './takeFromPantry'

// Every change reads the stored meal and writes it back in one transaction, so quick taps run one after the other and
// all count, instead of the second overwriting the first with a stale copy.

const find = (date: string, slot: MealSlot) =>
  db.mealPlan
    .where('date')
    .equals(date)
    .filter((e) => e.slot === slot)
    .first()

/** A meal you picked yourself. It replaces any constraint, and the planner leaves it alone. Returns the meal's id. */
export function setMeal(date: string, slot: MealSlot, recipeId: number, servingsPlanned: number) {
  return db.transaction('rw', db.mealPlan, async () => {
    const existing = await find(date, slot)
    // a different meal: what you were borrowing for the old one, or the foods it was, no longer apply
    const fields = {
      recipeId,
      servingsPlanned,
      status: 'planned' as const,
      constraint: undefined,
      cookDeleted: undefined,
      usedPantry: undefined,
      borrowed: undefined,
      foods: undefined,
      outKcal: undefined,
      outProtein: undefined,
    }
    if (existing?.id != null) {
      await db.mealPlan.update(existing.id, fields)
      return existing.id
    }
    return (await db.mealPlan.add({ date, slot, ...fields })) as number
  })
}

/**
 * A meal of plain foods, with no recipe ("3 eggs, a slice of toast and an apple"): the foods are kept on the meal itself.
 * It replaces whatever the meal was. `borrowed` are the foods that are not yours. Returns the meal's id.
 */
export function setFoods(date: string, slot: MealSlot, foods: RecipeIngredient[], borrowed: number[] = []) {
  return db.transaction('rw', db.mealPlan, async () => {
    const existing = await find(date, slot)
    const fields = {
      foods,
      borrowed: borrowed.length > 0 ? borrowed : undefined,
      recipeId: undefined,
      servingsPlanned: 1,
      status: 'planned' as const,
      constraint: undefined,
      cookDeleted: undefined,
      usedPantry: undefined,
      outKcal: undefined,
      outProtein: undefined,
    }
    if (existing?.id != null) {
      await db.mealPlan.update(existing.id, fields)
      return existing.id
    }
    return (await db.mealPlan.add({ date, slot, ...fields })) as number
  })
}

/** What eating out came to, as you entered it. A blank (undefined) clears that number. */
export function setEatingOut(id: number, numbers: { kcal?: number; protein?: number }) {
  return db.mealPlan.update(id, { outKcal: numbers.kcal, outProtein: numbers.protein })
}

/** Changes the foods of a meal of plain foods: add, remove or change how much. */
export function updateFoods(id: number, foods: RecipeIngredient[], borrowed: number[] = []) {
  return db.mealPlan.update(id, { foods, borrowed: borrowed.length > 0 ? borrowed : undefined })
}

/**
 * An earlier version saved a meal of plain foods as a hidden recipe. Moves each one's foods onto the meals that use it,
 * and deletes the recipe. Safe to run on every start.
 */
export function moveAdhocRecipesToMeals() {
  return db.transaction('rw', db.recipes, db.mealPlan, async () => {
    const adhoc = await db.recipes.filter((r) => !!r.adhoc).toArray()
    for (const r of adhoc) {
      for (const e of await db.mealPlan.filter((x) => x.recipeId === r.id).toArray()) {
        await db.mealPlan.update(e.id!, { foods: r.ingredients, recipeId: undefined, servingsPlanned: 1 })
      }
      await db.recipes.delete(r.id!)
    }
  })
}

/** Say you are borrowing a food for a meal (it is not taken from your pantry or bought), or that it is yours after all. */
export function setBorrowed(id: number, foodId: number, borrowed: boolean) {
  return db.transaction('rw', db.mealPlan, async () => {
    const entry = await db.mealPlan.get(id)
    if (!entry) return
    const next = new Set(entry.borrowed ?? [])
    if (borrowed) next.add(foodId)
    else next.delete(foodId)
    await db.mealPlan.update(id, { borrowed: next.size > 0 ? [...next] : undefined })
  })
}

/**
 * "Leftovers", "Eating out", "Quick" or "Let the planner choose" for a meal. The recipe is cleared: "Plan these days" fills it
 * in (or "Eating out" needs none). Your chosen times are kept.
 */
export function setConstraint(date: string, slot: MealSlot, constraint: SlotConstraint) {
  return db.transaction('rw', db.mealPlan, async () => {
    const existing = await find(date, slot)
    const keepOut = constraint === 'out' ? {} : { outKcal: undefined, outProtein: undefined }
    const fields = { constraint, recipeId: undefined, foods: undefined, status: 'planned' as const, cookDeleted: undefined, ...keepOut }
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

/** Set when you eat a meal. `undefined` goes back to your usual time for it. */
export function setTimes(id: number, times: Partial<Pick<MealPlanEntry, 'eatAt'>>) {
  return db.mealPlan.update(id, times)
}

/**
 * Mark a meal as made (or eaten, for leftovers). With `cooked`, the food it took is taken out of the pantry: the recipe as
 * you make it, for every serving cooked (leftovers included). Leftovers take nothing: that food went when they were cooked.
 */
export function markMade(
  id: number,
  cooked?: { recipe: Pick<Recipe, 'ingredients' | 'servings'>; servings: number; byId: Map<number, Ingredient>; today: string },
) {
  return db.transaction('rw', db.mealPlan, db.pantryItems, async () => {
    const entry = await db.mealPlan.get(id)
    if (!entry || entry.status === 'cooked') return
    let usedPantry: MealPlanEntry['usedPantry']
    if (cooked) {
      const { changes, used } = takeFromPantry(cooked.recipe, cooked.servings, await db.pantryItems.toArray(), cooked.byId, cooked.today, entry.borrowed)
      for (const c of changes) {
        if (c.qty > 0) await db.pantryItems.update(c.item.id!, { qty: c.qty })
        else await db.pantryItems.delete(c.item.id!)
      }
      if (used.length > 0) usedPantry = used
    }
    await db.mealPlan.update(id, { status: 'cooked', usedPantry })
  })
}

/** Back to planned: anything making it took from the pantry is put back (an item that was used up comes back as it was). */
export function unmarkMade(id: number) {
  return db.transaction('rw', db.mealPlan, db.pantryItems, async () => {
    const entry = await db.mealPlan.get(id)
    if (!entry) return
    for (const u of entry.usedPantry ?? []) {
      const now = await db.pantryItems.get(u.id)
      if (now) await db.pantryItems.update(u.id, { qty: Math.round((now.qty + u.took) * 100) / 100 })
      else await db.pantryItems.put(u.before)
    }
    await db.mealPlan.update(id, { status: 'planned', usedPantry: undefined })
  })
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
