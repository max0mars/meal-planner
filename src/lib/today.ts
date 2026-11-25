import type { MealPlanEntry, MealSlot, PantryItem, Settings } from '../types'
import { SOON_DAYS, daysLeft } from './pantry'
import { SLOT_ORDER } from './plan'
import { toMinutes } from './times'

export interface TodayMeal {
  slot: MealSlot
  /** Missing when nothing has been planned for this meal yet. */
  entry?: MealPlanEntry
  /** When you eat it (HH:MM): the time set on the meal, otherwise your usual time. */
  time: string
  /** Earlier today, the one coming up, or later on. */
  state: 'past' | 'next' | 'later'
  /** You marked it made (or eaten). */
  made: boolean
}

/**
 * Today's meals in the order you eat them: the meals you plan (even if nothing is chosen yet) and any other meal that has
 * something planned. The first one whose time has not gone and that you have not made yet is "next". A skipped meal is left
 * out. Once every meal is past, there is no next.
 */
export function todaysMeals(
  entries: MealPlanEntry[],
  date: string,
  planSlots: MealSlot[],
  mealTimes: NonNullable<Settings['mealTimes']>,
  nowMinutes: number,
): TodayMeal[] {
  const day = entries.filter((e) => e.date === date && e.status !== 'skipped')
  const meals = SLOT_ORDER.filter((s) => planSlots.includes(s) || day.some((e) => e.slot === s)).map((slot) => {
    const entry = day.find((e) => e.slot === slot)
    return { slot, entry, time: entry?.eatAt ?? mealTimes[slot] }
  })
  meals.sort((a, b) => toMinutes(a.time) - toMinutes(b.time) || SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot))
  const made = (m: (typeof meals)[number]) => m.entry?.status === 'cooked'
  const next = meals.findIndex((m) => toMinutes(m.time) >= nowMinutes && !made(m))
  return meals.map((m, i) => ({ ...m, made: made(m), state: next < 0 || i < next ? 'past' : i === next ? 'next' : 'later' }))
}

/** Pantry food that is past its date or goes off within a few days, soonest first. */
export function itemsToUseSoon(pantry: PantryItem[], today: string): PantryItem[] {
  return pantry
    .filter((p) => daysLeft(p.expiresOn, today) <= SOON_DAYS)
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || (a.id ?? 0) - (b.id ?? 0))
}
