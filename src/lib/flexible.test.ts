import { describe, expect, it } from 'vitest'
import seed from '../data/ingredients.seed.json'
import recipes from '../data/recipes.seed.json'
import type { Ingredient, PantryItem, RecipeIngredient, Sensitivity } from '../types'
import { candidatesFor, describeChoices, isFlexibleRecipe, lineName, resolveRecipe, setOptionalUse } from './flexible'
import { pantryMatch } from './pantryMatch'
import { classifyRecipe } from './recipeSafety'

const all: Ingredient[] = (seed as Ingredient[]).map((i, n) => ({ ...i, id: n + 1 }))
const byId = new Map(all.map((i) => [i.id!, i]))
const id = (name: string) => all.find((i) => i.name === name)!.id!
const name = (foodId: number) => byId.get(foodId)!.name
const line = (food: string, qty: number, more: Partial<RecipeIngredient> = {}): RecipeIngredient => ({ ingredientId: id(food), qty, unit: 'g', ...more })
const levels = (entries: [string, Sensitivity][] = []) => new Map(entries)
const stock = (food: string, qty: number, expiresOn = '2099-01-01'): PantryItem => ({
  ingredientId: id(food), qty, unit: 'g', purchasedOn: '2026-01-01', expiresOn, location: 'fridge',
})

const meat = line('Ground beef (80/20)', 450, { anyCategory: 'meat', label: 'Meat' })
const pasta = line('Wheat pasta', 340, { anyOf: [id('Whole wheat pasta'), id('Gluten-free pasta')], label: 'Pasta' })
const onion: RecipeIngredient = { ingredientId: id('Onion'), qty: 1, unit: 'piece', optional: true }
const recipe = { servings: 4, servingsPerMeal: 1, ingredients: [meat, pasta, onion] }

describe('flexible recipes', () => {
  it('lists every food a line can be: the default, then listed foods, then the rest of the category', () => {
    expect(candidatesFor(pasta, byId).map((f) => f.name)).toEqual(['Wheat pasta', 'Whole wheat pasta', 'Gluten-free pasta'])
    const meats = candidatesFor(meat, byId)
    expect(meats[0].name).toBe('Ground beef (80/20)')
    expect(meats.every((f) => f.category === 'meat')).toBe(true)
    expect(meats.length).toBe(all.filter((f) => f.category === 'meat').length)
  })

  it('names and describes a flexible line', () => {
    expect(lineName(meat, byId)).toBe('Meat')
    expect(lineName({ ...meat, label: undefined }, byId)).toBe('Any meat')
    expect(describeChoices(meat, byId)).toBe('any meat')
    expect(describeChoices(pasta, byId)).toBe('Wheat pasta, Whole wheat pasta or Gluten-free pasta')
  })

  it('knows a plain recipe from a flexible one, and leaves a plain one exactly as it is', () => {
    const plain = { servings: 2, ingredients: [line('Chicken breast', 300)] }
    expect(isFlexibleRecipe(plain)).toBe(false)
    expect(isFlexibleRecipe(recipe)).toBe(true)
    expect(resolveRecipe(plain, { byId, levels: levels() }).recipe).toBe(plain)
  })

  it('uses the defaults when nothing else matters', () => {
    const { recipe: r, dropped } = resolveRecipe(recipe, { byId, levels: levels() })
    expect(r.ingredients.map((l) => name(l.ingredientId))).toEqual(['Ground beef (80/20)', 'Wheat pasta', 'Onion'])
    expect(dropped).toEqual([])
  })

  it('uses the meat and pasta you have in the pantry', () => {
    const pantry = [stock('Chicken thigh', 500), stock('Whole wheat pasta', 500)]
    const { recipe: r } = resolveRecipe(recipe, { byId, levels: levels(), pantry, date: '2026-11-25' })
    expect(r.ingredients.map((l) => name(l.ingredientId))).toEqual(['Chicken thigh', 'Whole wheat pasta', 'Onion'])
    // the chosen line still lists the default among its choices
    expect(r.ingredients[1].anyOf).toContain(id('Wheat pasta'))
  })

  it('prefers enough of a food over a little of another, and ignores food that has gone off', () => {
    const pantry = [stock('Chicken thigh', 100), stock('Pork chop', 600), stock('Ground turkey', 900, '2026-11-01')]
    const { recipe: r } = resolveRecipe(recipe, { byId, levels: levels(), pantry, date: '2026-11-25' })
    expect(name(r.ingredients[0].ingredientId)).toBe('Pork chop')
  })

  it('picks a safe choice over one you are sensitive to, even when the pantry has the other', () => {
    const pantry = [stock('Wheat pasta', 1000)]
    const { recipe: r } = resolveRecipe(recipe, { byId, levels: levels([['gluten', 'major']]), pantry, date: '2026-11-25' })
    expect(name(r.ingredients[1].ingredientId)).toBe('Gluten-free pasta')
    expect(classifyRecipe(r, byId, levels([['gluten', 'major']]), 0.3).status).toBe('ok')
  })

  it('leaves out an optional food you are sensitive to, so the recipe is still offered', () => {
    const lv = levels([['onion-garlic', 'major']])
    const { recipe: r, dropped } = resolveRecipe(recipe, { byId, levels: lv })
    expect(r.ingredients.map((l) => name(l.ingredientId))).not.toContain('Onion')
    expect(dropped.map((d) => [d.food.name, d.level])).toEqual([['Onion', 'major']])
    expect(classifyRecipe(r, byId, lv, 0.3).status).toBe('ok')
    // the same food, not optional, rules the recipe out
    const fixed = { ...recipe, ingredients: [meat, pasta, { ...onion, optional: false }] }
    expect(classifyRecipe(resolveRecipe(fixed, { byId, levels: lv }).recipe, byId, lv, 0.3).status).toBe('excluded')
  })

  it('leaves out an optional food you make the recipe without, whatever your sensitivities', () => {
    const without = { ...recipe, ingredients: [meat, pasta, { ...onion, leftOut: true }] }
    const { recipe: r, dropped } = resolveRecipe(without, { byId, levels: levels() })
    expect(r.ingredients.map((l) => name(l.ingredientId))).toEqual(['Ground beef (80/20)', 'Wheat pasta'])
    expect(dropped.map((d) => [d.food.name, d.chosen, d.index])).toEqual([['Onion', true, 2]])
    expect(setOptionalUse(setOptionalUse(onion, false), true)).toEqual(onion)
  })

  it('does not count an optional food you do not have as missing from the pantry', () => {
    const pantry = [stock('Ground beef (80/20)', 500), stock('Wheat pasta', 500)]
    const match = pantryMatch(recipe, pantry, byId, '2026-11-25', '2026-11-25')
    expect(match.missing).toEqual([])
    expect(match.total).toBe(2)
  })

  it('skips choices that no longer exist, and falls back to another when the default food is gone', () => {
    const gone = new Map(byId)
    gone.delete(id('Wheat pasta'))
    const { recipe: r } = resolveRecipe({ ingredients: [pasta] }, { byId: gone, levels: levels() })
    expect(name(r.ingredients[0].ingredientId)).toBe('Whole wheat pasta')
  })
})

describe('the meat sauce pasta starter recipe', () => {
  const pastaRecipe = (recipes as { seedId: string; ingredients: { name: string; optional?: boolean; anyOf?: string[]; anyCategory?: string; label?: string }[] }[]).find(
    (r) => r.seedId === 'basic:meat-sauce-pasta',
  )!

  it('takes any meat, pasta and pasta sauce, with optional onion and garlic', () => {
    const by = new Map(pastaRecipe.ingredients.map((l) => [l.label ?? l.name, l]))
    expect(by.get('Meat')?.anyCategory).toBe('meat')
    expect(by.get('Pasta')?.anyOf).toEqual(['Whole wheat pasta', 'Gluten-free pasta'])
    expect(by.get('Pasta sauce')?.anyOf?.length).toBeGreaterThan(0)
    expect(by.get('Onion')?.optional).toBe(true)
    expect(by.get('Garlic')?.optional).toBe(true)
    for (const l of pastaRecipe.ingredients) for (const n of [l.name, ...(l.anyOf ?? [])]) expect(all.some((f) => f.name === n)).toBe(true)
  })
})
