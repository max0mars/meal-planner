import { describe, expect, it } from 'vitest'
import seed from '../data/ingredients.seed.json'
import recipes from '../data/recipes.seed.json'
import type { Ingredient, RecipeIngredient } from '../types'
import { mergeDuplicateLines } from './mergeLines'
import { recipeNutrition } from './nutrition'

const all: Ingredient[] = (seed as Ingredient[]).map((i, n) => ({ ...i, id: n + 1 }))
const byId = new Map(all.map((i) => [i.id!, i]))
const id = (name: string) => all.find((i) => i.name === name)!.id!
const line = (name: string, qty: number, unit: RecipeIngredient['unit'] = 'g'): RecipeIngredient => ({ ingredientId: id(name), qty, unit })

describe('merging repeated ingredient lines', () => {
  it('adds the same food in the same unit, keeping the first position', () => {
    const merged = mergeDuplicateLines([line('Haddock', 250), line('Salmon', 250), line('Haddock', 250)], byId)
    expect(merged).toEqual([line('Haddock', 500), line('Salmon', 250)])
  })

  it('adds different units in grams when both can be weighed', () => {
    // 1 tbsp of butter is about 14 g, so with 75 g that is about 89 g
    const merged = mergeDuplicateLines([line('Butter', 1, 'tbsp'), line('Butter', 75)], byId)
    expect(merged).toHaveLength(1)
    expect(merged[0].unit).toBe('g')
    expect(merged[0].qty).toBeGreaterThan(88)
    expect(merged[0].qty).toBeLessThan(90)
  })

  it('weighs pieces too, when the food has a piece weight', () => {
    const merged = mergeDuplicateLines([line('Eggs', 2, 'piece'), line('Eggs', 100)], byId)
    expect(merged).toEqual([{ ingredientId: id('Eggs'), qty: 200, unit: 'g' }]) // 2 x 50 g + 100 g
  })

  it('keeps both lines when one of them cannot be weighed, rather than guess', () => {
    const lines = [line('Rice noodles', 2, 'piece'), line('Rice noodles', 100)] // no piece weight for noodles
    expect(mergeDuplicateLines(lines, byId)).toEqual(lines)
  })

  it('leaves a list with no repeats exactly as it was, and handles an empty one', () => {
    const lines = [line('Salmon', 250), line('Potato', 500)]
    expect(mergeDuplicateLines(lines, byId)).toEqual(lines)
    expect(mergeDuplicateLines([], byId)).toEqual([])
  })

  it('does not change the calories or protein, which is the whole point', () => {
    const lines = [line('Butter', 1, 'tbsp'), line('Salmon', 250), line('Butter', 75), line('Whole milk', 568, 'ml'), line('Whole milk', 0.25, 'tsp')]
    const before = recipeNutrition({ servings: 4, ingredients: lines }, byId)
    const after = recipeNutrition({ servings: 4, ingredients: mergeDuplicateLines(lines, byId) }, byId)
    expect(after.totalKcal).toBeCloseTo(before.totalKcal, 1) // grams are kept to 2 decimals
    expect(after.totalProtein).toBeCloseTo(before.totalProtein, 1)
  })
})

describe('the starter recipes', () => {
  it('no recipe lists the same food twice after merging', () => {
    // the seed file is saved already merged, so this guards the importer
    const idByName = new Map(all.map((i) => [i.name, i.id!]))
    for (const r of recipes as { title: string; ingredients: { name: string }[] }[]) {
      const names = r.ingredients.map((l) => l.name)
      expect(new Set(names).size, `${r.title} repeats a food: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`).toBe(names.length)
      expect(names.every((n) => idByName.has(n))).toBe(true)
    }
  })

  it('Three Fish Pie lists haddock once, as 500 g', () => {
    const pie = (recipes as { title: string; ingredients: { name: string; qty: number; unit: string }[] }[]).find((r) => r.title === 'Three Fish Pie')!
    const haddock = pie.ingredients.filter((l) => l.name === 'Haddock')
    expect(haddock).toEqual([{ name: 'Haddock', qty: 500, unit: 'g' }])
  })
})
