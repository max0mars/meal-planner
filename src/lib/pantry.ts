import type { Ingredient, PantryItem, StorageLocation, Unit } from '../types'
import { daysBetween } from './expiry'

/** Items expiring within this many days are shown under "use soon". */
export const SOON_DAYS = 3

export const LOCATION_ORDER: StorageLocation[] = ['fridge', 'freezer', 'pantry']
export const LOCATION_LABEL: Record<StorageLocation, string> = { fridge: 'Fridge', freezer: 'Freezer', pantry: 'Pantry' }

/** Today's date as a local YYYY-MM-DD string (not UTC, so it is right late in the evening). */
export function todayIso(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA')
}

/** "Thu, Nov 21" in the viewer's locale. */
export function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export type ExpiryStatus = 'expired' | 'today' | 'soon' | 'ok'

export function daysLeft(expiresOn: string, today: string): number {
  return daysBetween(today, expiresOn)
}

export function expiryStatus(days: number): ExpiryStatus {
  if (days < 0) return 'expired'
  if (days === 0) return 'today'
  return days <= SOON_DAYS ? 'soon' : 'ok'
}

/** The big number and its caption shown beside a pantry item. */
export function expiryLabel(days: number): { value: string; caption: string } {
  if (days < 0) return { value: String(-days), caption: days === -1 ? 'day past' : 'days past' }
  if (days === 0) return { value: '0', caption: 'last day' }
  return { value: String(days), caption: days === 1 ? 'day left' : 'days left' }
}

/** Share of the item's shelf life still remaining, 0 to 1. */
export function shelfFraction(purchasedOn: string, expiresOn: string, today: string): number {
  const total = Math.max(1, daysBetween(purchasedOn, expiresOn))
  return Math.min(1, Math.max(0, daysBetween(today, expiresOn) / total))
}

export type UrgencyKey = 'expired' | 'soon' | 'later'
export interface UrgencyGroup {
  key: UrgencyKey
  title: string
  items: PantryItem[]
}

/** Splits items into past-date / use-soon / later, each sorted by soonest expiry. */
export function groupByUrgency(items: PantryItem[], today: string): UrgencyGroup[] {
  const sorted = [...items].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn) || (a.id ?? 0) - (b.id ?? 0))
  const groups: UrgencyGroup[] = [
    { key: 'expired', title: 'Past date', items: [] },
    { key: 'soon', title: `Use in the next ${SOON_DAYS} days`, items: [] },
    { key: 'later', title: 'Later', items: [] },
  ]
  for (const item of sorted) {
    const days = daysLeft(item.expiresOn, today)
    groups[days < 0 ? 0 : days <= SOON_DAYS ? 1 : 2].items.push(item)
  }
  return groups.filter((g) => g.items.length > 0)
}

/** Storage places this ingredient has a shelf-life guideline for, in display order. */
export function locationsFor(ingredient: Pick<Ingredient, 'shelfLifeDays'>): StorageLocation[] {
  const found = LOCATION_ORDER.filter((l) => ingredient.shelfLifeDays[l] != null)
  return found.length > 0 ? found : ['fridge']
}

const PANTRY_FIRST = new Set(['grains', 'legumes', 'nuts-seeds', 'fats-oils', 'spices-herbs', 'pantry'])

/** Where this food is usually kept: dry goods in the pantry, fresh foods in the fridge. */
export function defaultLocation(ingredient: Pick<Ingredient, 'shelfLifeDays' | 'category'>): StorageLocation {
  const options = locationsFor(ingredient)
  const { pantry, fridge } = ingredient.shelfLifeDays
  const keepsOnShelf =
    PANTRY_FIRST.has(ingredient.category) ||
    ((ingredient.category === 'produce' || ingredient.category === 'fruit') && pantry != null && fridge != null && pantry >= fridge)
  if (keepsOnShelf && options.includes('pantry')) return 'pantry'
  return options.includes('fridge') ? 'fridge' : options[0]
}

const LIQUID = /\b(milk|broth|cream|half and half|vinegar|sauce|oil)\b/i

/** A sensible default unit so adding groceries needs fewer taps. */
export function defaultUnit(ingredient: Pick<Ingredient, 'name' | 'category'>): Unit {
  if (/^eggs?\b/i.test(ingredient.name) && !/white/i.test(ingredient.name)) return 'piece'
  if (ingredient.category === 'fats-oils' || LIQUID.test(ingredient.name)) return 'ml'
  return 'g'
}

/**
 * Ranks ingredients for the "what did you buy?" box: exact name, then a whole alias, then name prefix,
 * then alias prefix, then word-start, then contains. When several foods share an alias ("milk", "rice"),
 * the one listed first in the ingredient list wins, so "rice" is White rice, not Rice flour.
 */
export function searchIngredients<T extends Pick<Ingredient, 'name' | 'aliases'>>(all: T[], query: string, limit = 6): T[] {
  // Hyphens count as spaces, so "all purpose flour" finds All-purpose flour.
  const norm = (s: string) => s.toLowerCase().replace(/-/g, ' ')
  const q = norm(query.trim())
  if (!q) return []
  const scored: { item: T; score: number; order: number }[] = []
  for (const [order, item] of all.entries()) {
    const name = norm(item.name)
    const aliases = item.aliases.map(norm)
    let score = -1
    if (name === q) score = 0
    else if (aliases.includes(q)) score = 0.5
    else if (name.startsWith(q)) score = 1
    else if (aliases.some((a) => a.startsWith(q))) score = 2
    else if (name.split(/[\s(,]+/).some((w) => w.startsWith(q))) score = 3
    else if (name.includes(q) || aliases.some((a) => a.includes(q))) score = 4
    if (score >= 0) scored.push({ item, score, order })
  }
  return scored
    .sort((a, b) => a.score - b.score || (a.score === 0.5 ? a.order - b.order : a.item.name.length - b.item.name.length))
    .slice(0, limit)
    .map((s) => s.item)
}
