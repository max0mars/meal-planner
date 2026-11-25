import { CATEGORIES } from '../data/categories'
import type { Ingredient, MealSlot, PantryItem, Recipe, Trip } from '../types'
import { daysBetween, defaultExpiry } from './expiry'
import { byDateThenSlot, type CookSession } from './plan'
import { byTripOrder, tripBefore, upcomingTrips } from './trips'
import { defaultLocation, defaultUnit, formatDate } from './pantry'
import { formatAmount } from './scaling'
import { toGrams } from './units'

/** Up to this many days away, a need is told as a number of days. Further off, it is told as a date. */
export const NEEDED_IN_DAYS = 5

/**
 * When something is needed, in words: "today", "tomorrow", "in 3 days", and a date ("by Mon, Nov 30") once it is more than
 * 5 days away. `label` is the same with a capital, for a badge. `urgent` is true for today and tomorrow, so the list can make
 * those stand out. Past dates count as today.
 */
export function neededWhen(needBy: string, today: string): { text: string; label: string; urgent: boolean } {
  const days = daysBetween(today, needBy)
  const make = (text: string, urgent: boolean) => ({ text, label: text.charAt(0).toUpperCase() + text.slice(1), urgent })
  if (days <= 0) return make('today', true)
  if (days === 1) return make('tomorrow', true)
  if (days <= NEEDED_IN_DAYS) return make(`in ${days} days`, false)
  return make(`by ${formatDate(needBy)}`, false)
}

/**
 * What you need to buy that no grocery trip will bring in time. With trips planned, these are the things needed before the
 * first trip. With no trip scheduled, nothing will bring any of it, so it is everything still to buy.
 */
export function missingWithNoTrip(toBuy: ShopItem[], byTrip: TripShopping | null): ShopItem[] {
  return byTrip ? byTrip.beforeFirstTrip : toBuy
}

/** How many things on the list are needed today and tomorrow. Anything already past due counts as today. */
export function dueCounts(items: Pick<ShopItem, 'needBy'>[], today: string): { today: number; tomorrow: number } {
  const counts = { today: 0, tomorrow: 0 }
  for (const item of items) {
    const when = neededWhen(item.needBy, today).text
    if (when === 'today') counts.today++
    else if (when === 'tomorrow') counts.tomorrow++
  }
  return counts
}

/** Seasonings and water are assumed to be in the cupboard, so they are not counted or listed with amounts. */
export function isStaple(food: Ingredient): boolean {
  return food.category === 'spices-herbs' || /^(water|salt)\b/i.test(food.name)
}

export interface ShopItem {
  food: Ingredient
  needGrams: number
  /** Grams in the pantry that will still be good on the day it is first needed. */
  haveGrams: number
  buyGrams: number
  /** The first day any meal needs it. */
  needBy: string
  /** Which meal of that day, so a trip later the same day is not counted as before it. */
  needBySlot: MealSlot
  uses: { title: string; date: string; slot: MealSlot; grams: number }[]
  /** True when every recipe counts it in pieces, so it can be shown in pieces ("6 eggs"). */
  allPieces: boolean
  /** True when some pantry stock could not be weighed, so the amount to buy may be too high. */
  unknownStock: boolean
}

export interface ShoppingList {
  toBuy: ShopItem[]
  /** Needed, but the pantry already covers it. */
  have: ShopItem[]
  /** Seasonings and water the recipes use: check the cupboard rather than buy by weight. */
  cupboard: Ingredient[]
  /** Ingredients whose amount could not be turned into a weight, so they are not in the totals. */
  unweighed: Ingredient[]
}

const categoryRank = (c: string) => {
  const i = CATEGORIES.findIndex((x) => x.id === c)
  return i === -1 ? CATEGORIES.length : i
}

/**
 * What to buy for a set of cooking sessions: each ingredient's total across all meals, less what the pantry has that will
 * still be good when it is first needed. Pantry food that has gone off by then is not counted.
 */
export function buildShoppingList(
  sessions: CookSession[],
  recipes: Map<number, Recipe>,
  byId: Map<number, Ingredient>,
  pantry: PantryItem[],
): ShoppingList {
  const needs = new Map<number, ShopItem>()
  const cupboard = new Map<number, Ingredient>()
  const unweighed = new Map<number, Ingredient>()
  const nonPieces = new Set<number>()

  for (const session of sessions) {
    const recipe = recipes.get(session.recipeId)
    if (!recipe || recipe.servings <= 0) continue
    const factor = session.servings / recipe.servings
    for (const line of recipe.ingredients) {
      const food = byId.get(line.ingredientId)
      if (!food) continue
      if (isStaple(food)) {
        cupboard.set(food.id!, food)
        continue
      }
      const grams = toGrams(line.qty * factor, line.unit, food)
      if (grams == null) {
        unweighed.set(food.id!, food)
        continue
      }
      if (line.unit !== 'piece') nonPieces.add(food.id!)
      const item = needs.get(food.id!)
      const slot = session.entries[0]?.slot ?? 'breakfast' // no meal on record: assume the earliest, so a trip must come first
      const use = { title: recipe.title, date: session.cookOn, slot, grams }
      if (item) {
        item.needGrams += grams
        item.uses.push(use)
        if (byDateThenSlot({ date: session.cookOn, slot }, { date: item.needBy, slot: item.needBySlot }) < 0) {
          item.needBy = session.cookOn
          item.needBySlot = slot
        }
      } else {
        needs.set(food.id!, { food, needGrams: grams, haveGrams: 0, buyGrams: 0, needBy: session.cookOn, needBySlot: slot, uses: [use], allPieces: false, unknownStock: false })
      }
    }
  }

  const toBuy: ShopItem[] = []
  const have: ShopItem[] = []
  for (const item of needs.values()) {
    item.allPieces = !nonPieces.has(item.food.id!)
    for (const p of pantry) {
      if (p.ingredientId !== item.food.id || p.qty <= 0 || p.expiresOn < item.needBy) continue
      const g = toGrams(p.qty, p.unit, item.food)
      if (g == null) item.unknownStock = true
      else item.haveGrams += g
    }
    item.buyGrams = Math.max(0, item.needGrams - item.haveGrams)
    // under a gram is rounding noise, not something to buy
    ;(item.buyGrams >= 1 ? toBuy : have).push(item)
  }

  const order = (a: ShopItem, b: ShopItem) => categoryRank(a.food.category) - categoryRank(b.food.category) || a.food.name.localeCompare(b.food.name)
  return {
    toBuy: toBuy.sort(order),
    have: have.sort(order),
    cupboard: [...cupboard.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unweighed: [...unweighed.values()],
  }
}

/** The category's name for a shopping aisle heading. */
export function aisleLabel(category: string): string {
  return CATEGORIES.find((c) => c.id === category)?.label ?? 'Other'
}

/**
 * For each meal, the foods it uses that you still have to buy and that no scheduled grocery trip will bring in time. Keyed
 * by `date|slot` of the meal that is cooked. Pantry stock is spread over the meals in the order they come, so only the meals
 * the pantry cannot cover are listed. With no trips scheduled, that is every meal that is short of something.
 */
export function mealShortfalls(toBuy: ShopItem[], trips: Trip[], today: string, order?: MealSlot[]): Map<string, string[]> {
  const ahead = upcomingTrips(trips, today)
  const out = new Map<string, string[]>()
  for (const item of toBuy) {
    let left = item.haveGrams
    const uses = [...item.uses].sort(byDateThenSlot)
    for (const use of uses) {
      if (left >= use.grams - 1e-9) {
        left -= use.grams
        continue
      }
      left = 0
      if (ahead.some((t) => tripBefore(t, use.date, use.slot, order))) continue
      const key = `${use.date}|${use.slot}`
      out.set(key, [...(out.get(key) ?? []), item.food.name])
    }
  }
  return out
}

export interface TripGroup {
  trip: Trip
  items: ShopItem[]
}

export interface TripShopping {
  /** Upcoming trips in order, each with what to buy on it. */
  groups: TripGroup[]
  /** Needed before the first trip: a trip cannot get these in time. */
  beforeFirstTrip: ShopItem[]
}

/**
 * Puts each item on the last grocery trip that comes before it is needed, so it is as fresh as it can be. An item
 * needed before any trip has none, and is listed apart so you can shop sooner or change that meal. Returns null when
 * there are no upcoming trips, in which case the list falls back to your usual shopping days.
 */
export function assignToTrips(toBuy: ShopItem[], trips: Trip[], today: string, order?: MealSlot[]): TripShopping | null {
  const ahead = upcomingTrips(trips, today).sort((a, b) => byTripOrder(a, b, order))
  if (ahead.length === 0) return null
  const groups: TripGroup[] = ahead.map((trip) => ({ trip, items: [] }))
  const beforeFirstTrip: ShopItem[] = []
  for (const item of toBuy) {
    const usable = groups.filter((g) => tripBefore(g.trip, item.needBy, item.needBySlot, order))
    if (usable.length === 0) beforeFirstTrip.push(item)
    else usable[usable.length - 1].items.push(item)
  }
  return { groups, beforeFirstTrip }
}

/** The pantry entry to create when you tick something off as bought: enough to cover what is needed, in a sensible unit. */
export function boughtPantryItem(food: Ingredient, buyGrams: number, today: string): Omit<PantryItem, 'id'> {
  const location = defaultLocation(food)
  const unit = defaultUnit(food)
  let qty = Math.ceil(buyGrams)
  let outUnit: PantryItem['unit'] = 'g'
  if (unit === 'piece' && food.gramsPerPiece) {
    qty = Math.ceil(buyGrams / food.gramsPerPiece - 1e-9)
    outUnit = 'piece'
  } else if (unit === 'ml') {
    const gramsPerMl = toGrams(1, 'ml', food)
    if (gramsPerMl) {
      qty = Math.ceil(buyGrams / gramsPerMl)
      outUnit = 'ml'
    }
  }
  return { ingredientId: food.id!, qty, unit: outUnit, purchasedOn: today, expiresOn: defaultExpiry(food, today, location), location }
}

/** An amount in the way you would buy it: pieces for eggs, millilitres for liquids, otherwise grams. */
export function formatBuy(food: Ingredient, grams: number, allPieces: boolean): string {
  if (allPieces && food.gramsPerPiece) return formatAmount(Math.ceil(grams / food.gramsPerPiece - 1e-9), 'piece')
  if (defaultUnit(food) === 'ml') {
    const gramsPerMl = toGrams(1, 'ml', food)
    if (gramsPerMl) return formatAmount(grams / gramsPerMl, 'ml')
  }
  return formatAmount(grams, 'g')
}
