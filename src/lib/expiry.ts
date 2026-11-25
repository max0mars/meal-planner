import type { Ingredient, StorageLocation } from '../types'

const DAY_MS = 86_400_000

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  return new Date(d.getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / DAY_MS,
  )
}

/** Expiry date = purchase date + the ingredient's default shelf life for that storage location. */
export function defaultExpiry(
  ingredient: Pick<Ingredient, 'shelfLifeDays'>,
  purchasedOn: string,
  location: StorageLocation,
): string {
  const days = ingredient.shelfLifeDays[location] ?? ingredient.shelfLifeDays.fridge ?? 7
  return addDays(purchasedOn, days)
}
