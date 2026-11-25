import type { MealPlanEntry, MealSlot, SlotConstraint } from '../types'
import { addDays, daysBetween } from './expiry'

export const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
export const SLOT_LABEL: Record<MealSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }

/** What each kind of meal is called on the plan. */
export const CONSTRAINT_LABEL: Record<SlotConstraint, string> = {
  leftovers: 'Leftovers',
  out: 'Eating out',
  quick: 'Little time',
  any: 'Planner’s choice',
}

/** `count` consecutive dates starting at `start` (YYYY-MM-DD). */
export function weekDays(start: string, count = 7): string[] {
  return Array.from({ length: count }, (_, i) => addDays(start, i))
}

export const mealKey = (date: string, slot: MealSlot) => `${date}|${slot}`

const slotRank = (s: MealSlot) => SLOT_ORDER.indexOf(s)

export function byDateThenSlot(a: Pick<MealPlanEntry, 'date' | 'slot'>, b: Pick<MealPlanEntry, 'date' | 'slot'>): number {
  return a.date.localeCompare(b.date) || slotRank(a.slot) - slotRank(b.slot)
}

/** Calories and protein in one serving of a recipe. */
export interface PerServing {
  kcal: number
  protein: number
}

/** What a planned meal adds up to: the recipe's per-serving numbers times the servings you plan to eat. */
export function mealNutrition(entry: Pick<MealPlanEntry, 'recipeId' | 'servingsPlanned'>, perServing: Map<number, PerServing>): PerServing {
  const p = entry.recipeId == null ? undefined : perServing.get(entry.recipeId)
  return p ? { kcal: p.kcal * entry.servingsPlanned, protein: p.protein * entry.servingsPlanned } : { kcal: 0, protein: 0 }
}

/** Everything planned for one day, added up. Skipped meals do not count. */
export function dayTotals(entries: MealPlanEntry[], date: string, perServing: Map<number, PerServing>): PerServing & { meals: number } {
  let kcal = 0
  let protein = 0
  let meals = 0
  for (const e of entries) {
    if (e.date !== date || e.status === 'skipped') continue
    const n = mealNutrition(e, perServing)
    kcal += n.kcal
    protein += n.protein
    meals++
  }
  return { kcal, protein, meals }
}

/** One cooking of a recipe, which may feed several planned meals. */
export interface CookSession {
  recipeId: number
  /** The day it is cooked: the first meal it feeds. */
  cookOn: string
  /** Total servings to cook, across all the meals it feeds. */
  servings: number
  entries: MealPlanEntry[]
}

/**
 * Groups planned meals into cooking sessions. Meals of the same recipe within `windowDays` of the first one are one
 * cook (the later ones are leftovers), so you cook once and eat it again, and the shopping list asks for one batch.
 * Meals already cooked or skipped are left out.
 */
export function cookSessions(entries: MealPlanEntry[], windowDays: number): CookSession[] {
  // meals with no recipe yet (a constraint, or eating out) cook nothing
  const planned = entries.filter((e) => e.status === 'planned' && e.recipeId != null).sort(byDateThenSlot)
  const open = new Map<number, CookSession>()
  const sessions: CookSession[] = []
  for (const e of planned) {
    const recipeId = e.recipeId!
    const current = open.get(recipeId)
    if (current && daysBetween(current.cookOn, e.date) <= windowDays) {
      current.servings += e.servingsPlanned
      current.entries.push(e)
    } else {
      const fresh: CookSession = { recipeId, cookOn: e.date, servings: e.servingsPlanned, entries: [e] }
      open.set(recipeId, fresh)
      sessions.push(fresh)
    }
  }
  return sessions.sort((a, b) => a.cookOn.localeCompare(b.cookOn))
}

/** True for meals that are eaten from an earlier cook rather than cooked fresh. */
export function isLeftover(entry: MealPlanEntry, sessions: CookSession[]): boolean {
  const s = sessions.find((x) => x.entries.some((e) => e === entry || (e.id != null && e.id === entry.id)))
  return !!s && s.entries[0] !== entry && !(s.entries[0].id != null && s.entries[0].id === entry.id)
}
