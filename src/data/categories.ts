import type { StorageLocation } from '../types'

export interface CategoryDef {
  id: string
  label: string
  /** How many days it usually lasts in each place, from the day it is bought. */
  shelfLifeDays: Partial<Record<StorageLocation, number>>
}

/** Kinds of food. The category sets sensible shelf-life and unit defaults for a food you add. */
export const CATEGORIES: CategoryDef[] = [
  { id: 'meat', label: 'Meat', shelfLifeDays: { fridge: 3, freezer: 270 } },
  { id: 'seafood', label: 'Fish and seafood', shelfLifeDays: { fridge: 2, freezer: 180 } },
  { id: 'dairy-eggs', label: 'Dairy and eggs', shelfLifeDays: { fridge: 10, freezer: 90 } },
  { id: 'produce', label: 'Vegetables', shelfLifeDays: { fridge: 7, freezer: 240, pantry: 5 } },
  { id: 'fruit', label: 'Fruit', shelfLifeDays: { fridge: 7, freezer: 240, pantry: 5 } },
  { id: 'grains', label: 'Grains, pasta and bread', shelfLifeDays: { pantry: 365, fridge: 365, freezer: 365 } },
  { id: 'legumes', label: 'Beans and lentils', shelfLifeDays: { pantry: 730, fridge: 730 } },
  { id: 'nuts-seeds', label: 'Nuts and seeds', shelfLifeDays: { pantry: 180, fridge: 365, freezer: 540 } },
  { id: 'fats-oils', label: 'Oils and fats', shelfLifeDays: { pantry: 365, fridge: 540 } },
  { id: 'spices-herbs', label: 'Herbs and spices', shelfLifeDays: { pantry: 730, fridge: 730 } },
  { id: 'pantry', label: 'Other pantry food', shelfLifeDays: { pantry: 365, fridge: 365 } },
]

export const CATEGORY_BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]))
