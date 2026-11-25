import { describe, expect, it } from 'vitest'
import seed from '../data/ingredients.seed.json'
import type { Ingredient, PantryItem, RecipeIngredient } from '../types'
import { takeFromPantry } from './takeFromPantry'

const all: Ingredient[] = (seed as Ingredient[]).map((i, n) => ({ ...i, id: n + 1 }))
const byId = new Map(all.map((i) => [i.id!, i]))
const id = (name: string) => all.find((i) => i.name === name)!.id!
const line = (name: string, qty: number, unit: RecipeIngredient['unit'] = 'g'): RecipeIngredient => ({ ingredientId: id(name), qty, unit })
let nextId = 1
const item = (name: string, qty: number, unit: PantryItem['unit'], expiresOn = '2026-12-31'): PantryItem => ({
  id: nextId++, ingredientId: id(name), qty, unit, purchasedOn: '2026-11-25', expiresOn, location: 'fridge',
})
const TODAY = '2026-11-25'

describe('taking what a meal used out of the pantry', () => {
  it('takes one onion out of three, and part of a packet', () => {
    const onions = item('Onion', 3, 'piece')
    const pasta = item('Wheat pasta', 454, 'g')
    const recipe = { servings: 1, ingredients: [line('Onion', 1, 'piece'), line('Wheat pasta', 227)] }
    const { changes } = takeFromPantry(recipe, 1, [onions, pasta], byId, TODAY)
    expect(changes.map((c) => [c.item.id, c.qty])).toEqual([[onions.id, 2], [pasta.id, 227]])
  })

  it('uses the food that goes off soonest first, and uses up an item exactly', () => {
    const later = item('Pork sausages', 6, 'piece', '2026-12-20')
    const sooner = item('Pork sausages', 2, 'piece', '2026-11-28')
    const recipe = { servings: 1, ingredients: [line('Pork sausages', 180)] } // 3 sausages of 60 g
    const { changes, used } = takeFromPantry(recipe, 1, [later, sooner], byId, TODAY)
    expect(changes.map((c) => [c.item.id, c.qty])).toEqual([[sooner.id, 0], [later.id, 5]])
    expect(used.map((u) => [u.id, u.took])).toEqual([[sooner.id, 2], [later.id, 1]])
  })

  it('scales to the servings cooked, leftovers included', () => {
    const beef = item('Ground beef (80/20)', 1000, 'g')
    const recipe = { servings: 4, ingredients: [line('Ground beef (80/20)', 400)] }
    expect(takeFromPantry(recipe, 6, [beef], byId, TODAY).changes[0].qty).toBe(400)
  })

  it('leaves seasonings, food that has gone off, and food it cannot weigh alone', () => {
    const salt = item('Salt', 500, 'g')
    const old = item('Onion', 2, 'piece', '2026-11-20')
    const noodles = item('Rice noodles', 2, 'piece') // no weight for a piece of noodles
    const recipe = { servings: 1, ingredients: [line('Salt', 1, 'tsp'), line('Onion', 1, 'piece'), line('Rice noodles', 100)] }
    expect(takeFromPantry(recipe, 1, [salt, old, noodles], byId, TODAY).changes).toEqual([])
  })

  it('leaves food you borrowed for the meal in the pantry', () => {
    const onions = item('Onion', 3, 'piece')
    const pasta = item('Wheat pasta', 454, 'g')
    const recipe = { servings: 1, ingredients: [line('Onion', 1, 'piece'), line('Wheat pasta', 227)] }
    const { changes } = takeFromPantry(recipe, 1, [onions, pasta], byId, TODAY, [id('Onion')])
    expect(changes.map((c) => c.item.id)).toEqual([pasta.id])
  })

  it('takes what there is when there is not enough', () => {
    const onions = item('Onion', 1, 'piece')
    const recipe = { servings: 1, ingredients: [line('Onion', 2, 'piece')] }
    expect(takeFromPantry(recipe, 1, [onions], byId, TODAY).changes.map((c) => c.qty)).toEqual([0])
  })
})
