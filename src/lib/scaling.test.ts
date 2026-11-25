import { describe, expect, it } from 'vitest'
import seed from '../data/ingredients.seed.json'
import type { Ingredient, PantryItem, RecipeIngredient } from '../types'
import {
  factorForServings,
  formatAmount,
  formatServings,
  lineCoverage,
  pantryCapacity,
  pantryGrams,
  scaleLines,
} from './scaling'

const all: Ingredient[] = (seed as Ingredient[]).map((i, n) => ({ ...i, id: n + 1 }))
const byId = new Map(all.map((i) => [i.id!, i]))
const food = (name: string) => all.find((i) => i.name === name)!
const line = (name: string, qty: number, unit: RecipeIngredient['unit'] = 'g'): RecipeIngredient => ({ ingredientId: food(name).id!, qty, unit })
const stock = (name: string, qty: number, unit: PantryItem['unit'] = 'g'): PantryItem => ({
  ingredientId: food(name).id!,
  qty,
  unit,
  purchasedOn: '2026-11-19',
  expiresOn: '2026-11-26',
  location: 'fridge',
})

describe('scaling a recipe', () => {
  it('multiplies every amount and leaves the original alone', () => {
    const original = [line('Chicken breast', 400), line('Olive oil', 2, 'tbsp')]
    const scaled = scaleLines(original, 1.5)
    expect(scaled.map((l) => l.qty)).toEqual([600, 3])
    expect(original.map((l) => l.qty)).toEqual([400, 2])
  })

  it('works out the multiplier for a number of servings', () => {
    expect(factorForServings(6, 4)).toBe(1.5)
    expect(factorForServings(2, 4)).toBe(0.5)
    expect(factorForServings(4, 4)).toBe(1)
    expect(factorForServings(3, 0)).toBe(1) // a recipe with no servings cannot be scaled by servings
  })

  it('shows servings as whole numbers or one decimal', () => {
    expect(formatServings(4)).toBe('4')
    expect(formatServings(3.4)).toBe('3.4')
    expect(formatServings(5.04)).toBe('5')
  })
})

describe('friendly amounts', () => {
  it('rounds grams and millilitres sensibly, and moves up to kg and L', () => {
    expect(formatAmount(300, 'g')).toBe('300 g')
    expect(formatAmount(677, 'g')).toBe('675 g')
    expect(formatAmount(42.4, 'g')).toBe('42 g')
    expect(formatAmount(7.26, 'g')).toBe('7.3 g')
    expect(formatAmount(1200, 'g')).toBe('1.2 kg')
    expect(formatAmount(250, 'ml')).toBe('250 ml')
    expect(formatAmount(1500, 'ml')).toBe('1.5 L')
  })

  it('shows teaspoons as fractions, and moves up to tablespoons', () => {
    expect(formatAmount(0.25, 'tsp')).toBe('¼ tsp')
    expect(formatAmount(1.5, 'tsp')).toBe('1½ tsp')
    expect(formatAmount(3, 'tsp')).toBe('1 tbsp')
    expect(formatAmount(4.5, 'tsp')).toBe('1½ tbsp')
    expect(formatAmount(0.04, 'tsp')).toBe('a pinch')
  })

  it('shows tablespoons and cups as fractions, with a plural only above one cup', () => {
    expect(formatAmount(2, 'tbsp')).toBe('2 tbsp')
    expect(formatAmount(2.5, 'tbsp')).toBe('2½ tbsp')
    expect(formatAmount(16, 'tbsp')).toBe('1 cup')
    expect(formatAmount(0.5, 'cup')).toBe('½ cup')
    expect(formatAmount(0.34, 'cup')).toBe('⅓ cup')
    expect(formatAmount(1, 'cup')).toBe('1 cup')
    expect(formatAmount(1.5, 'cup')).toBe('1½ cups')
    expect(formatAmount(2, 'cup')).toBe('2 cups')
  })

  it('shows pieces to the nearest quarter, and never rounds a real amount to nothing', () => {
    expect(formatAmount(1, 'piece')).toBe('1 piece')
    expect(formatAmount(1.5, 'piece')).toBe('1½ pieces')
    expect(formatAmount(4, 'piece')).toBe('4 pieces')
    expect(formatAmount(0.1, 'piece')).toBe('¼ piece')
  })

  it('scaling a recipe by 1.5 gives readable amounts', () => {
    const scaled = scaleLines([line('Olive oil', 1, 'tbsp'), line('Eggs', 3, 'piece'), line('White rice', 1, 'cup'), line('Salt', 0.5, 'tsp')], 1.5)
    expect(scaled.map((l) => formatAmount(l.qty, l.unit))).toEqual(['1½ tbsp', '4½ pieces', '1½ cups', '¾ tsp'])
  })
})

describe('what is in the pantry', () => {
  it('adds up several packs of the same food, and says nothing when there is none', () => {
    expect(pantryGrams(food('Chicken breast').id!, [stock('Chicken breast', 300), stock('Chicken breast', 150)], byId)).toEqual({ grams: 450, partial: false })
    expect(pantryGrams(food('Chicken breast').id!, [stock('Salmon', 300)], byId)).toBeNull()
    expect(pantryGrams(food('Chicken breast').id!, [stock('Chicken breast', 0)], byId)).toBeNull()
  })

  it('converts other units, and flags amounts that cannot be weighed', () => {
    expect(pantryGrams(food('Eggs').id!, [stock('Eggs', 6, 'piece')], byId)).toEqual({ grams: 300, partial: false })
    expect(pantryGrams(food('Rice noodles').id!, [stock('Rice noodles', 2, 'piece')], byId)).toEqual({ grams: 0, partial: true })
  })

  describe('line by line', () => {
    const pantry = [stock('Chicken breast', 450), stock('Eggs', 2, 'piece')]

    it('enough, short by how much, or none', () => {
      expect(lineCoverage(line('Chicken breast', 400), pantry, byId)).toMatchObject({ status: 'enough', haveGrams: 450, needGrams: 400 })
      expect(lineCoverage(line('Chicken breast', 600), pantry, byId)).toMatchObject({ status: 'short', shortByGrams: 150 })
      expect(lineCoverage(line('Salmon', 200), pantry, byId)).toMatchObject({ status: 'none', needGrams: 200 })
    })

    it('compares in grams even when the recipe uses pieces', () => {
      expect(lineCoverage(line('Eggs', 2, 'piece'), pantry, byId).status).toBe('enough')
      expect(lineCoverage(line('Eggs', 4, 'piece'), pantry, byId)).toMatchObject({ status: 'short', shortByGrams: 100 })
    })

    it('assumes seasonings and water are in the cupboard', () => {
      expect(lineCoverage(line('Salt', 1, 'tsp'), pantry, byId).status).toBe('assumed')
      expect(lineCoverage(line('Cumin', 1, 'tsp'), pantry, byId).status).toBe('assumed')
      expect(lineCoverage(line('Water', 200, 'ml'), pantry, byId).status).toBe('assumed')
    })

    it('does not guess when an amount cannot be weighed', () => {
      expect(lineCoverage(line('Rice noodles', 2, 'piece'), [stock('Rice noodles', 300)], byId).status).toBe('unknown')
    })
  })
})

describe('the most you could make from your pantry', () => {
  const lines = [line('Chicken breast', 400), line('White rice', 200), line('Salt', 1, 'tsp'), line('Water', 300, 'ml')]

  it('is limited by whichever food runs out first, and ignores seasonings and water', () => {
    const cap = pantryCapacity(lines, [stock('Chicken breast', 800), stock('White rice', 300)], byId)
    expect(cap?.kind).toBe('max')
    if (cap?.kind === 'max') {
      expect(cap.factor).toBeCloseTo(1.5) // rice: 300 / 200 beats chicken: 800 / 400 = 2
      expect(cap.limiting.name).toBe('White rice')
    }
  })

  it('lists what is missing when something is not in the pantry at all', () => {
    const cap = pantryCapacity(lines, [stock('Chicken breast', 800)], byId)
    expect(cap).toEqual({ kind: 'missing', foods: [food('White rice')] })
  })

  it('says nothing when the pantry is empty', () => {
    expect(pantryCapacity(lines, [], byId)).toBeNull()
  })

  it('never lets an optional food limit the batch or block it', () => {
    const withOnion = [...lines, { ...line('Onion', 1, 'piece'), optional: true }]
    const cap = pantryCapacity(withOnion, [stock('Chicken breast', 800), stock('White rice', 300)], byId) // no onion at all
    if (cap?.kind !== 'max') throw new Error('expected a max')
    expect(cap.factor).toBeCloseTo(1.5)
    expect(cap.limiting.name).toBe('White rice')
  })

  it('works on an already scaled recipe', () => {
    const cap = pantryCapacity(scaleLines(lines, 2), [stock('Chicken breast', 800), stock('White rice', 300)], byId)
    if (cap?.kind !== 'max') throw new Error('expected a max')
    expect(cap.factor).toBeCloseTo(0.75) // of the doubled recipe
  })
})
