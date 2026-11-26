import { describe, expect, it } from 'vitest'
import type { PantryItem } from '../types'
import {
  amountLabel,
  daysLeft,
  defaultLocation,
  defaultUnit,
  expiryLabel,
  expiryStatus,
  groupByUrgency,
  locationsFor,
  searchIngredients,
  timeLeftFraction,
} from './pantry'

const TODAY = '2026-11-19'
const item = (id: number, expiresOn: string): PantryItem => ({
  id,
  ingredientId: 1,
  qty: 1,
  unit: 'g',
  purchasedOn: '2026-11-15',
  expiresOn,
  location: 'fridge',
})

describe('expiry status and labels', () => {
  it('counts days left, negative once past', () => {
    expect(daysLeft('2026-11-22', TODAY)).toBe(3)
    expect(daysLeft('2026-11-19', TODAY)).toBe(0)
    expect(daysLeft('2026-11-17', TODAY)).toBe(-2)
  })

  it('classifies status', () => {
    expect(expiryStatus(-1)).toBe('expired')
    expect(expiryStatus(0)).toBe('today')
    expect(expiryStatus(3)).toBe('soon')
    expect(expiryStatus(4)).toBe('ok')
  })

  it('words the label with correct singular/plural', () => {
    expect(expiryLabel(5)).toEqual({ value: '5', caption: 'days left' })
    expect(expiryLabel(1)).toEqual({ value: '1', caption: 'day left' })
    expect(expiryLabel(0)).toEqual({ value: '0', caption: 'last day' })
    expect(expiryLabel(-1)).toEqual({ value: '1', caption: 'day past' })
    expect(expiryLabel(-4)).toEqual({ value: '4', caption: 'days past' })
  })

  it('fills the time-left bar by days left out of 21, full beyond that and empty once due', () => {
    expect(timeLeftFraction('2026-12-10', '2026-11-19')).toBe(1) // exactly 21 days
    expect(timeLeftFraction('2027-11-19', '2026-11-19')).toBe(1) // a year: stays full
    expect(timeLeftFraction('2026-11-26', '2026-11-19')).toBeCloseTo(7 / 21)
    expect(timeLeftFraction('2026-11-20', '2026-11-19')).toBeCloseTo(1 / 21)
    expect(timeLeftFraction('2026-11-19', '2026-11-19')).toBe(0) // the use-by day
    expect(timeLeftFraction('2026-11-10', '2026-11-19')).toBe(0) // past it
    // only the days left count, not when it was bought: chicken with 3 days left reads the same whenever it was bought
    expect(timeLeftFraction('2026-11-22', '2026-11-19')).toBeCloseTo(3 / 21)
  })
})

describe('groupByUrgency', () => {
  it('splits into past, soon and later, soonest first, dropping empty groups', () => {
    const groups = groupByUrgency([item(1, '2026-12-01'), item(2, '2026-11-18'), item(3, '2026-11-21'), item(4, '2026-11-19')], TODAY)
    expect(groups.map((g) => g.key)).toEqual(['expired', 'soon', 'later'])
    expect(groups[0].items.map((i) => i.id)).toEqual([2])
    expect(groups[1].items.map((i) => i.id)).toEqual([4, 3])
    expect(groups[2].items.map((i) => i.id)).toEqual([1])
    expect(groupByUrgency([item(1, '2026-12-01')], TODAY).map((g) => g.key)).toEqual(['later'])
    expect(groupByUrgency([], TODAY)).toEqual([])
  })
})

describe('storage defaults', () => {
  const chicken = { category: 'meat', shelfLifeDays: { fridge: 3, freezer: 270 } }
  const rice = { category: 'grains', shelfLifeDays: { pantry: 365, fridge: 365, freezer: 365 } }
  const potato = { category: 'produce', shelfLifeDays: { pantry: 30, fridge: 30 } }
  const berries = { category: 'fruit', shelfLifeDays: { fridge: 4, freezer: 365 } }
  const banana = { category: 'fruit', shelfLifeDays: { pantry: 5, fridge: 7, freezer: 180 } }

  it('only offers places that have a shelf-life guideline', () => {
    expect(locationsFor(chicken)).toEqual(['fridge', 'freezer'])
    expect(locationsFor(rice)).toEqual(['fridge', 'freezer', 'pantry'])
  })

  it('keeps dry goods in the pantry and fresh foods in the fridge', () => {
    expect(defaultLocation(chicken)).toBe('fridge')
    expect(defaultLocation(rice)).toBe('pantry')
    expect(defaultLocation(potato)).toBe('pantry')
    expect(defaultLocation(berries)).toBe('fridge')
    expect(defaultLocation(banana)).toBe('fridge')
  })

  it('picks a default unit', () => {
    expect(defaultUnit({ name: 'Eggs', category: 'dairy-eggs' })).toBe('piece')
    expect(defaultUnit({ name: 'Egg whites', category: 'dairy-eggs' })).toBe('g')
    expect(defaultUnit({ name: 'Whole milk', category: 'dairy-eggs' })).toBe('ml')
    expect(defaultUnit({ name: 'Olive oil', category: 'fats-oils' })).toBe('ml')
    expect(defaultUnit({ name: 'Chicken breast', category: 'meat' })).toBe('g')
  })
})

describe('searchIngredients', () => {
  const foods = [
    { name: 'Whole milk', aliases: ['milk'] },
    { name: 'Almond milk (unsweetened)', aliases: ['milk'] },
    { name: 'Milk chocolate', aliases: [] },
    { name: 'Raspberries', aliases: [] },
    { name: 'Chicken breast', aliases: ['chicken'] },
    { name: 'Ground chicken', aliases: ['chicken'] },
  ]

  it('ranks a whole alias first (earliest listed food wins), then prefixes, then looser matches', () => {
    expect(searchIngredients(foods, 'milk').map((f) => f.name)).toEqual(['Whole milk', 'Almond milk (unsweetened)', 'Milk chocolate'])
  })

  it('finds foods by alias', () => {
    expect(searchIngredients(foods, 'chicken').map((f) => f.name)).toEqual(['Chicken breast', 'Ground chicken'])
  })

  it('finds a word in the middle of a name', () => {
    expect(searchIngredients(foods, 'unsweet').map((f) => f.name)).toEqual(['Almond milk (unsweetened)'])
  })

  it('returns nothing for an empty or unmatched query and respects the limit', () => {
    expect(searchIngredients(foods, '  ')).toEqual([])
    expect(searchIngredients(foods, 'zzz')).toEqual([])
    expect(searchIngredients(foods, 'milk', 2)).toHaveLength(2)
  })
})

describe('how much you have, as the big number on a pantry item', () => {
  it('reads weights, volumes and pieces plainly, and large amounts in kg and L', () => {
    expect(amountLabel(227, 'g')).toEqual({ value: '227', caption: 'g' })
    expect(amountLabel(1500, 'g')).toEqual({ value: '1.5', caption: 'kg' })
    expect(amountLabel(2000, 'ml')).toEqual({ value: '2', caption: 'L' })
    expect(amountLabel(2, 'piece')).toEqual({ value: '2', caption: 'pieces' })
    expect(amountLabel(1, 'piece')).toEqual({ value: '1', caption: 'piece' })
    expect(amountLabel(0.333, 'cup')).toEqual({ value: '0.33', caption: 'cups' })
  })
})
