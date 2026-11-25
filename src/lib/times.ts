import type { MealPlanEntry, MealSlot, Settings, Trip } from '../types'
import { SLOT_ORDER, mealKey } from './plan'

type MealTimes = NonNullable<Settings['mealTimes']>

const DAY = 24 * 60

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function fromMinutes(total: number): string {
  const t = Math.min(DAY - 1, Math.max(0, Math.round(total)))
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export type TimeFormat = NonNullable<Settings['timeFormat']>

/**
 * The meals in the order you eat them, by your usual times. A snack at 3:30 PM sits between lunch and dinner. Meals at the
 * same time keep the order breakfast, lunch, dinner, snack.
 */
export function slotOrder(mealTimes: MealTimes): MealSlot[] {
  return [...SLOT_ORDER].sort((a, b) => toMinutes(mealTimes[a]) - toMinutes(mealTimes[b]) || SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b))
}

/** "18:30" as "6:30 PM", or as "18:30" in 24-hour form. Times are always stored as HH:MM (24-hour); this is only how they look. */
export function formatTime(hhmm: string, format: TimeFormat = '12h'): string {
  const [h, m] = hhmm.split(':').map(Number)
  const hour = Number.isFinite(h) ? h : 0
  const minute = String(Number.isFinite(m) ? m : 0).padStart(2, '0')
  if (format === '24h') return `${String(hour).padStart(2, '0')}:${minute}`
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`
}

/** When you eat a meal: the time you set for that meal on the plan, otherwise your usual time for it. */
export function eatTime(entry: Pick<MealPlanEntry, 'slot' | 'eatAt'>, mealTimes: MealTimes): string {
  return entry.eatAt ?? mealTimes[entry.slot]
}

/**
 * When to start cooking so the meal is ready at `eatAt`: the recipe's time before it, on a 5 minute mark (earlier, never
 * later, so it is never late). A recipe longer than the time since midnight starts at midnight.
 */
export function cookStart(eatAt: string, minutes: number): string {
  return fromMinutes(Math.floor((toMinutes(eatAt) - minutes) / 5) * 5)
}

/** The time to start cooking a meal: the one you set, otherwise worked out from the eat time and the recipe's time. */
export function cookTime(entry: Pick<MealPlanEntry, 'slot' | 'eatAt' | 'cookAt'>, estMinutes: number, mealTimes: MealTimes): string {
  return entry.cookAt ?? cookStart(eatTime(entry, mealTimes), estMinutes)
}

/**
 * The meals today whose time has already gone, as "date|slot" keys, so the planner does not plan a lunch for 12:30 when
 * it is already 3 in the afternoon. The time you usually eat that meal is what counts.
 */
export function passedSlots(today: string, now: Date, slots: MealSlot[], mealTimes: MealTimes): string[] {
  const minutes = now.getHours() * 60 + now.getMinutes()
  return slots.filter((s) => toMinutes(mealTimes[s]) <= minutes).map((s) => mealKey(today, s))
}

const SHOP_LEAD = 90 // minutes: a trip to the shops at the edge of the day, before the first meal or after the last

/**
 * A sensible time for a grocery trip: 90 minutes before the first meal of the day, midway between two meals, or 90
 * minutes after the last one. `meals` are the slots you plan, so a lunch-and-dinner day has three places for a trip.
 */
export function defaultTripTime(after: Trip['after'], meals: MealSlot[], mealTimes: MealTimes): string {
  const sorted = slotOrder(mealTimes).filter((s) => meals.includes(s))
  if (sorted.length === 0) return after === 'start' ? '09:00' : '17:00'
  if (after === 'start') return fromMinutes(toMinutes(mealTimes[sorted[0]]) - SHOP_LEAD)
  const i = sorted.indexOf(after)
  const here = i >= 0 ? toMinutes(mealTimes[sorted[i]]) : toMinutes(mealTimes[after])
  const next = i >= 0 ? sorted[i + 1] : undefined
  return next ? fromMinutes((here + toMinutes(mealTimes[next])) / 2) : fromMinutes(here + SHOP_LEAD)
}
