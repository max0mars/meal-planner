import type { MealSlot, Trip } from '../types'

/** Where a grocery trip sits in the day: "start" is before the first meal, "lunch" is after lunch. */
export type TripAfter = Trip['after']

/** The usual order of meals. Pass the order from your meal times (slotOrder) so a snack sits where you eat it. */
const DEFAULT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
const rank = (order: MealSlot[], place: TripAfter) => (place === 'start' ? -1 : order.indexOf(place))

/** Is a grocery trip finished before this meal? A trip after lunch is before dinner, but not before lunch. */
export function tripBefore(trip: Pick<Trip, 'date' | 'after'>, date: string, slot: MealSlot, order: MealSlot[] = DEFAULT_ORDER): boolean {
  return trip.date < date || (trip.date === date && rank(order, trip.after) < rank(order, slot))
}

/** Trips that are still ahead of you (today or later). Trips already gone cannot buy anything for a meal. */
export function upcomingTrips(trips: Trip[], today: string): Trip[] {
  return trips.filter((t) => t.date >= today)
}

/** Order trips by day, then by where in the day they are. */
export function byTripOrder(a: Pick<Trip, 'date' | 'after'>, b: Pick<Trip, 'date' | 'after'>, order: MealSlot[] = DEFAULT_ORDER): number {
  return a.date.localeCompare(b.date) || rank(order, a.after) - rank(order, b.after)
}

const SLOT_WORD: Record<MealSlot, string> = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', snack: 'a snack' }

/** Where a trip sits in words, for the meals you plan: "before lunch", "between lunch and dinner", "after dinner". */
export function tripPosition(after: TripAfter, planSlots: MealSlot[], order: MealSlot[] = DEFAULT_ORDER): string {
  const meals = order.filter((s) => planSlots.includes(s))
  if (meals.length === 0) return after === 'start' ? 'in the morning' : 'later in the day'
  if (after === 'start') return `before ${SLOT_WORD[meals[0]]}`
  const i = meals.indexOf(after)
  const next = i >= 0 ? meals[i + 1] : meals.find((s) => rank(order, s) > rank(order, after))
  return next ? `between ${SLOT_WORD[after]} and ${SLOT_WORD[next]}` : `after ${SLOT_WORD[after]}`
}
