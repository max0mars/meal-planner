import { describe, expect, it } from 'vitest'
import seed from '../data/ingredients.seed.json'
import type { Ingredient, MealPlanEntry, MealSlot, PantryItem, Recipe, RecipeIngredient, Trip } from '../types'
import { daysBetween } from './expiry'
import { recipeNutrition } from './nutrition'
import {
  byDateThenSlot,
  cookSessions,
  dayTotals,
  isLeftover,
  mealKey,
  mealNutrition,
  weekDays,
  type PerServing,
} from './plan'
import { planWeek, suggestPlan, suitsSlot, type Candidate } from './planner'
import { recipeKinds } from './recipeFilters'
import { aisleLabel, boughtPantryItem, buildShoppingList, mealShortfalls } from './shopping'

const all: Ingredient[] = (seed as Ingredient[]).map((i, n) => ({ ...i, id: n + 1 }))
const byId = new Map(all.map((i) => [i.id!, i]))
const food = (name: string) => all.find((i) => i.name === name)!
const line = (name: string, qty: number, unit: RecipeIngredient['unit'] = 'g'): RecipeIngredient => ({ ingredientId: food(name).id!, qty, unit })
let nextId = 1
const recipe = (title: string, lines: RecipeIngredient[], extra: Partial<Recipe> = {}): Recipe & { id: number } => ({
  id: nextId++,
  title,
  servings: 4,
  servingsPerMeal: 1,
  ingredients: lines,
  steps: ['Cook it.'],
  estMinutes: 30,
  actualMinutesHistory: [],
  ...extra,
})
const candidate = (r: Recipe & { id: number }, warn = false): Candidate => {
  const n = recipeNutrition(r, byId)
  return { recipe: r, perServing: { kcal: n.kcalPerServing, protein: n.proteinPerServing }, kinds: recipeKinds(r, byId), warn }
}
const entry = (date: string, slot: MealSlot, recipeId: number, servings = 1, status: MealPlanEntry['status'] = 'planned'): MealPlanEntry => ({
  id: nextId++, date, slot, recipeId, servingsPlanned: servings, status,
})
const stock = (name: string, qty: number, expiresOn: string, unit: PantryItem['unit'] = 'g'): PantryItem => ({
  ingredientId: food(name).id!, qty, unit, purchasedOn: '2026-11-19', expiresOn, location: 'fridge',
})

const TODAY = '2026-11-19' // a Thursday

describe('days, totals and cook sessions', () => {
  it('lists consecutive days, across a month end', () => {
    expect(weekDays('2026-11-28', 4)).toEqual(['2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01'])
    expect(weekDays(TODAY)).toHaveLength(7)
  })

  it('orders meals by day, then breakfast to snack', () => {
    const list = [entry('2026-11-20', 'dinner', 1), entry('2026-11-19', 'snack', 1), entry('2026-11-19', 'breakfast', 1), entry('2026-11-19', 'dinner', 1)]
    expect(list.sort(byDateThenSlot).map((e) => `${e.date.slice(8)}-${e.slot}`)).toEqual(['19-breakfast', '19-dinner', '19-snack', '20-dinner'])
  })

  it('scales a meal by the servings you plan to eat, and adds a day up without skipped meals', () => {
    const per = new Map<number, PerServing>([[1, { kcal: 500, protein: 40 }], [2, { kcal: 300, protein: 10 }]])
    expect(mealNutrition({ recipeId: 1, servingsPlanned: 1.5 }, per)).toEqual({ kcal: 750, protein: 60 })
    expect(mealNutrition({ recipeId: 99, servingsPlanned: 1 }, per)).toEqual({ kcal: 0, protein: 0 }) // a deleted recipe adds nothing
    const day = [entry(TODAY, 'lunch', 1), entry(TODAY, 'dinner', 1, 2), entry(TODAY, 'snack', 2, 1, 'skipped'), entry('2026-11-20', 'lunch', 2)]
    expect(dayTotals(day, TODAY, per)).toEqual({ kcal: 1500, protein: 120, meals: 2 })
  })

  it('treats meals of one recipe within the leftover window as one cook, with the servings added up', () => {
    const entries = [entry('2026-11-19', 'dinner', 7), entry('2026-11-20', 'lunch', 7), entry('2026-11-21', 'dinner', 8)]
    const sessions = cookSessions(entries, 4)
    expect(sessions).toHaveLength(2)
    expect(sessions[0]).toMatchObject({ recipeId: 7, cookOn: '2026-11-19', servings: 2 })
    expect(sessions[1]).toMatchObject({ recipeId: 8, cookOn: '2026-11-21', servings: 1 })
  })

  it('starts a new cook when the next meal is beyond the window', () => {
    const entries = [entry('2026-11-19', 'dinner', 7), entry('2026-11-20', 'lunch', 7), entry('2026-11-25', 'dinner', 7)]
    const sessions = cookSessions(entries, 4)
    expect(sessions.map((s) => [s.cookOn, s.servings])).toEqual([['2026-11-19', 2], ['2026-11-25', 1]])
  })

  it('leaves out skipped meals, marks a made one done, and says which meals are leftovers', () => {
    const first = entry('2026-11-19', 'dinner', 7)
    const second = entry('2026-11-20', 'lunch', 7)
    const made = entry('2026-11-20', 'dinner', 9, 1, 'cooked')
    const sessions = cookSessions([first, second, made, entry('2026-11-25', 'lunch', 3, 1, 'skipped')], 4)
    expect(sessions.map((s) => [s.recipeId, s.done])).toEqual([[7, false], [9, true]])
    expect(isLeftover(first, sessions)).toBe(false)
    expect(isLeftover(second, sessions)).toBe(true)
  })

  it('keeps the leftovers of a meal you have made as leftovers, rather than a meal to cook', () => {
    const made = entry('2026-11-19', 'dinner', 7, 1, 'cooked')
    const later = entry('2026-11-20', 'lunch', 7)
    const sessions = cookSessions([made, later], 4)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].done).toBe(true)
    expect(isLeftover(later, sessions)).toBe(true)
  })
})

describe('a meal out', () => {
  it('counts the calories and protein you entered, and nothing when you have not', () => {
    const out = { ...entry('2026-11-19', 'dinner', 0), recipeId: undefined, constraint: 'out' as const }
    expect(dayTotals([out], '2026-11-19', new Map())).toEqual({ kcal: 0, protein: 0, meals: 1 })
    expect(dayTotals([{ ...out, outKcal: 850, outProtein: 40 }], '2026-11-19', new Map())).toEqual({ kcal: 850, protein: 40, meals: 1 })
  })
})

describe('the shopping list', () => {
  it('does not ask you to buy food you are borrowing for a meal', () => {
    const r = recipe('Eggs on toast', [line('Eggs', 2, 'piece'), line('White bread', 60)])
    const meal = { ...entry('2026-11-19', 'lunch', r.id), borrowed: [food('Eggs').id!] }
    const list = buildShoppingList(cookSessions([meal], 4), new Map([[r.id, r]]), byId, [])
    expect(list.toBuy.map((i) => i.food.name)).toEqual(['White bread'])
  })

  it('asks for nothing for a meal you have already made, or its leftovers', () => {
    const r = recipe('Stew', [line('Beef chuck roast', 500)])
    const sessions = cookSessions([entry('2026-11-19', 'dinner', r.id, 1, 'cooked'), entry('2026-11-20', 'lunch', r.id)], 4)
    expect(buildShoppingList(sessions, new Map([[r.id, r]]), byId, []).toBuy).toEqual([])
    const fresh = cookSessions([entry('2026-11-19', 'dinner', r.id), entry('2026-11-20', 'lunch', r.id)], 4)
    expect(buildShoppingList(fresh, new Map([[r.id, r]]), byId, []).toBuy.map((i) => i.food.name)).toEqual(['Beef chuck roast'])
  })

  const chickenRice = recipe('Chicken and rice', [line('Chicken breast', 400), line('White rice', 200), line('Salt', 1, 'tsp'), line('Cumin', 1, 'tsp'), line('Eggs', 2, 'piece')])
  const recipes = new Map([[chickenRice.id, chickenRice]])
  const session = (servings: number, cookOn = '2026-11-20') => ({ recipeId: chickenRice.id, cookOn, servings, entries: [] })

  it('scales a cook to the servings you will eat', () => {
    const list = buildShoppingList([session(6)], recipes, byId, [])
    const chicken = list.toBuy.find((i) => i.food.name === 'Chicken breast')!
    expect(chicken.needGrams).toBe(600) // 400 g x 6 / 4
    expect(chicken.buyGrams).toBe(600)
    expect(list.toBuy.find((i) => i.food.name === 'Eggs')).toMatchObject({ needGrams: 150, allPieces: true }) // 3 eggs at 50 g
  })

  it('takes off what the pantry has, and moves fully covered foods to "have"', () => {
    const list = buildShoppingList([session(4)], recipes, byId, [stock('Chicken breast', 150, '2026-12-01'), stock('White rice', 500, '2027-01-01')])
    expect(list.toBuy.find((i) => i.food.name === 'Chicken breast')).toMatchObject({ haveGrams: 150, buyGrams: 250 })
    expect(list.toBuy.some((i) => i.food.name === 'White rice')).toBe(false)
    expect(list.have.map((i) => i.food.name)).toEqual(['White rice'])
  })

  it('does not count pantry food that will have gone off by the day it is needed', () => {
    const list = buildShoppingList([session(4, '2026-11-25')], recipes, byId, [stock('Chicken breast', 400, '2026-11-22')])
    expect(list.toBuy.find((i) => i.food.name === 'Chicken breast')).toMatchObject({ haveGrams: 0, buyGrams: 400 })
  })

  it('adds the needs of several recipes and the first day it is needed', () => {
    const stirFry = recipe('Chicken stir-fry', [line('Chicken breast', 300)])
    const both = new Map([...recipes, [stirFry.id, stirFry]])
    const list = buildShoppingList(
      [session(4, '2026-11-22'), { recipeId: stirFry.id, cookOn: '2026-11-20', servings: 4, entries: [] }],
      both,
      byId,
      [],
    )
    const chicken = list.toBuy.find((i) => i.food.name === 'Chicken breast')!
    expect(chicken.needGrams).toBe(700)
    expect(chicken.needBy).toBe('2026-11-20')
    expect(chicken.uses.map((u) => u.title).sort()).toEqual(['Chicken and rice', 'Chicken stir-fry'])
  })

  it('does not list seasonings by weight: they go to "check the cupboard"', () => {
    const list = buildShoppingList([session(4)], recipes, byId, [])
    expect(list.cupboard.map((f) => f.name)).toEqual(['Cumin', 'Salt'])
    expect(list.toBuy.some((i) => ['Salt', 'Cumin'].includes(i.food.name))).toBe(false)
  })

  it('groups by aisle, in a shopping order', () => {
    const mixed = recipe('Mixed', [line('Chicken breast', 400), line('Carrot', 200), line('White rice', 200), line('Whole milk', 200, 'ml')])
    const list = buildShoppingList([{ recipeId: mixed.id, cookOn: TODAY, servings: 4, entries: [] }], new Map([[mixed.id, mixed]]), byId, [])
    expect(list.toBuy.map((i) => aisleLabel(i.food.category))).toEqual(['Meat', 'Dairy and eggs', 'Vegetables', 'Grains, pasta and bread'])
  })

  it('reports amounts it cannot weigh instead of dropping them', () => {
    const odd = recipe('Odd', [line('Rice noodles', 2, 'piece'), line('Chicken breast', 200)])
    const list = buildShoppingList([{ recipeId: odd.id, cookOn: TODAY, servings: 4, entries: [] }], new Map([[odd.id, odd]]), byId, [])
    expect(list.unweighed.map((f) => f.name)).toEqual(['Rice noodles'])
    expect(list.toBuy.map((i) => i.food.name)).toEqual(['Chicken breast'])
  })

  it('ignores a recipe that has been deleted', () => {
    expect(buildShoppingList([{ recipeId: 9999, cookOn: TODAY, servings: 4, entries: [] }], recipes, byId, [])).toMatchObject({ toBuy: [], have: [] })
  })
})

describe('meals with food no trip will bring', () => {
  const items = buildShoppingList(
    [{ recipeId: 1, cookOn: '2026-11-20', servings: 4, entries: [{ slot: 'dinner' } as MealPlanEntry] }],
    new Map([[1, recipe('A', [line('Chicken breast', 400)], { id: 1 })]]),
    byId,
    [],
  ).toBuy

  it('flags the meal when no grocery trip is scheduled', () => {
    expect(mealShortfalls(items, [], TODAY)).toEqual(new Map([['2026-11-20|dinner', ['Chicken breast']]]))
  })

  it('flags nothing when a trip comes before the meal, or there is nothing to buy', () => {
    const trip = { id: 1, date: '2026-11-20', after: 'lunch', time: '15:00' } as Trip
    expect(mealShortfalls(items, [trip], TODAY).size).toBe(0)
    expect(mealShortfalls([], [], TODAY).size).toBe(0)
  })

  it('still flags the meal when the only trip is after it', () => {
    const trip = { id: 1, date: '2026-11-20', after: 'dinner', time: '20:00' } as Trip
    expect(mealShortfalls(items, [trip], TODAY).size).toBe(1)
  })
})

describe('ticking something off as bought', () => {
  it('adds it to the pantry in the unit you would count it in, rounded up, with a use-by date', () => {
    expect(boughtPantryItem(food('Eggs'), 150, TODAY)).toMatchObject({ qty: 3, unit: 'piece', location: 'fridge', purchasedOn: TODAY, expiresOn: '2026-12-17' })
    expect(boughtPantryItem(food('Eggs'), 160, TODAY)).toMatchObject({ qty: 4, unit: 'piece' })
    expect(boughtPantryItem(food('Chicken breast'), 612.4, TODAY)).toMatchObject({ qty: 613, unit: 'g', expiresOn: '2026-11-22' })
    const oil = boughtPantryItem(food('Olive oil'), 92, TODAY)
    expect(oil).toMatchObject({ unit: 'ml', location: 'pantry' })
    expect(oil.qty).toBeGreaterThanOrEqual(99)
    expect(oil.qty).toBeLessThanOrEqual(101) // 92 g of oil is about 100 ml
  })

  it('buying what the list says leaves nothing left to buy', () => {
    const r = recipe('Eggs and rice', [line('Eggs', 5, 'piece'), line('White rice', 150), line('Chicken breast', 333)])
    const sessions = [{ recipeId: r.id, cookOn: '2026-11-21', servings: 4, entries: [] }]
    const first = buildShoppingList(sessions, new Map([[r.id, r]]), byId, [])
    const bought = first.toBuy.map((i) => ({ ...boughtPantryItem(i.food, i.buyGrams, TODAY), id: 1 }))
    const second = buildShoppingList(sessions, new Map([[r.id, r]]), byId, bought)
    expect(second.toBuy).toEqual([])
    expect(second.have).toHaveLength(3)
  })
})

describe('suggesting a plan', () => {
  const chicken = candidate(recipe('Chicken and rice', [line('Chicken breast', 400), line('White rice', 200), line('Broccoli', 200)]))
  const beef = candidate(recipe('Beef stew', [line('Beef chuck roast', 500), line('Potato', 400), line('Carrot', 200)]))
  const salmon = candidate(recipe('Salmon and potatoes', [line('Salmon', 400), line('Potato', 400), line('Green beans', 200)]))
  const lentils = candidate(recipe('Lentil curry', [line('Lentils', 250), line('Onion', 200), line('Tomato', 300)]))
  const cake = candidate(recipe('Carrot cake', [line('All-purpose flour', 300), line('Carrot', 300), line('Sugar', 200)], { category: 'Dessert' }))
  const porridge = candidate(recipe('Porridge', [line('Rolled oats', 200), line('Whole milk', 600, 'ml')], { category: 'Breakfast' }))
  const mains = [chicken, beef, salmon, lentils]
  const base = { candidates: [...mains, cake, porridge], byId, pantry: [] as PantryItem[], today: TODAY, kcalTarget: 3000, leftoverDays: 4, existing: [] as MealPlanEntry[] }
  const days = weekDays(TODAY, 4)

  it('fills each empty slot once, and only the slots you ask for', () => {
    const plan = suggestPlan({ ...base, days, slots: ['dinner'] })
    expect(plan.map((p) => p.date)).toEqual(days)
    expect(plan.every((p) => p.slot === 'dinner' && p.status === 'planned' && p.servingsPlanned === 1)).toBe(true)
    expect(new Set(plan.map((p) => mealKey(p.date, p.slot))).size).toBe(plan.length)
  })

  it('gives the same plan every time for the same inputs', () => {
    expect(suggestPlan({ ...base, days, slots: ['lunch', 'dinner'] })).toEqual(suggestPlan({ ...base, days, slots: ['lunch', 'dinner'] }))
  })

  it('keeps meals you already planned, and fills around them', () => {
    const existing = [entry(days[1], 'dinner', beef.recipe.id)]
    const plan = suggestPlan({ ...base, days, slots: ['dinner'], existing })
    expect(plan.map((p) => p.date)).toEqual([days[0], days[2], days[3]])
    expect(plan.some((p) => p.recipeId === beef.recipe.id)).toBe(false) // not repeated right next to it
  })

  it('never puts a dessert in lunch or dinner, or a main in a snack, and uses breakfast recipes for breakfast only', () => {
    const plan = suggestPlan({ ...base, days, slots: ['breakfast', 'lunch', 'dinner', 'snack'] })
    for (const p of plan) {
      const c = base.candidates.find((x) => x.recipe.id === p.recipeId)!
      expect(suitsSlot(c, p.slot), `${p.slot}: ${c.recipe.title}`).toBe(true)
      if (p.slot === 'lunch' || p.slot === 'dinner') expect(c.recipe.category).not.toBe('Dessert')
      if (p.slot === 'breakfast') expect(c.recipe.category).toBe('Breakfast')
    }
    expect(plan.some((p) => p.slot === 'breakfast')).toBe(true)
  })

  it('does not repeat a recipe within three days when there is a choice', () => {
    const plan = suggestPlan({ ...base, days, slots: ['dinner'] })
    expect(new Set(plan.map((p) => p.recipeId)).size).toBe(4)
  })

  it('starts with the recipe that uses food about to go off, when everything else is equal', () => {
    // both dinners are completely covered by the pantry. The only difference is the salmon goes off tomorrow.
    // (Chicken and rice comes first alphabetically, so only the expiry can make Salmon win.)
    const longLife = '2026-12-30'
    const pantry = [
      stock('Chicken breast', 2000, longLife), stock('White rice', 1000, longLife), stock('Broccoli', 1000, longLife),
      stock('Salmon', 2000, '2026-11-20'), stock('Potato', 2000, longLife), stock('Green beans', 1000, longLife),
    ]
    const plan = suggestPlan({ ...base, candidates: [chicken, salmon], days: [TODAY], slots: ['dinner'], pantry })
    expect(plan[0].recipeId).toBe(salmon.recipe.id)
    // with nothing about to expire, the alphabetical tie goes the other way
    const relaxed = pantry.map((p) => ({ ...p, expiresOn: longLife }))
    expect(suggestPlan({ ...base, candidates: [chicken, salmon], days: [TODAY], slots: ['dinner'], pantry: relaxed })[0].recipeId).toBe(chicken.recipe.id)
  })

  it('prefers foods already in the plan, so there is less to buy', () => {
    // Both are potato-or-sweet-potato dishes with the same protein. The plan already needs potatoes, so only
    // reusing them can make Zed win over Aaa (which is first alphabetically and fits the calories very slightly better).
    const planned = candidate(recipe('Beef and potato', [line('Potato', 200), line('Beef chuck roast', 300)]))
    const aaa = candidate(recipe('Aaa sweet potato', [line('Sweet potato', 400)], { servings: 1 }))
    const zed = candidate(recipe('Zed potato', [line('Potato', 300)], { servings: 1 }))
    const plan = suggestPlan({ ...base, candidates: [planned, aaa, zed], days: [days[2]], slots: ['dinner'], existing: [entry(days[0], 'dinner', planned.recipe.id)] })
    expect(plan[0].recipeId).toBe(zed.recipe.id)
  })

  it('prefers the higher-protein recipe when the calories fit equally well', () => {
    const aaa = candidate(recipe('Aaa rice', [line('White rice', 300)])) // about 5 g protein a serving, 274 kcal
    const zed = candidate(recipe('Zed chicken', [line('Chicken breast', 600)])) // about 35 g protein, 171 kcal
    const plan = suggestPlan({ ...base, candidates: [aaa, zed], days: [TODAY], slots: ['dinner'] })
    expect(plan[0].recipeId).toBe(zed.recipe.id)
  })

  it('prefers the meal that fits what is left of the day\'s calories', () => {
    // target 500: Zed is about 500 kcal and good protein; Aaa is 900 kcal with more protein but a worse fit
    const zed = candidate(recipe('Zed fits', [line('Chicken breast', 150), line('White rice', 90)], { servings: 1 }))
    const aaa = candidate(recipe('Aaa too big', [line('Chicken breast', 800)], { servings: 1 }))
    expect(zed.perServing.kcal).toBeGreaterThan(450)
    expect(zed.perServing.kcal).toBeLessThan(550)
    const plan = suggestPlan({ ...base, candidates: [aaa, zed], days: [TODAY], slots: ['dinner'], kcalTarget: 500 })
    expect(plan[0].recipeId).toBe(zed.recipe.id)
  })

  it('avoids the same kind of meat as the meal just before, including one you planned yourself', () => {
    // Aaa (beef) is first alphabetically and has slightly more protein than Zed (chicken), so only variety makes Zed win.
    const before = candidate(recipe('Beef pie', [line('Ground beef (80/20)', 600)]))
    const aaa = candidate(recipe('Aaa beef', [line('Beef chuck roast', 600)]))
    const zed = candidate(recipe('Zed chicken', [line('Chicken thigh', 600)]))
    expect(aaa.perServing.protein).toBeGreaterThan(zed.perServing.protein)
    const plan = suggestPlan({ ...base, candidates: [before, aaa, zed], days: [days[1]], slots: ['dinner'], existing: [entry(days[0], 'dinner', before.recipe.id)] })
    expect(plan[0].recipeId).toBe(zed.recipe.id)
    // and with no beef just before, the beef dish is fine again
    expect(suggestPlan({ ...base, candidates: [before, aaa, zed], days: [days[1]], slots: ['dinner'] })[0].recipeId).toBe(aaa.recipe.id)
  })

  it('leans away from a recipe with a Light-sensitivity warning, all else equal', () => {
    const aaa = candidate(recipe('Aaa', [line('Chicken breast', 600)]), true)
    const zed = candidate(recipe('Zed', [line('Chicken breast', 600)]))
    expect(suggestPlan({ ...base, candidates: [aaa, zed], days: [TODAY], slots: ['dinner'] })[0].recipeId).toBe(zed.recipe.id)
  })

  it('does not count pantry food that will be gone before the meal', () => {
    // the salmon is good today only, so it cannot help tomorrow's dinner
    const pantry = [stock('Salmon', 400, TODAY)]
    const tomorrow = suggestPlan({ ...base, days: [days[1]], slots: ['dinner'], pantry })
    const withoutIt = suggestPlan({ ...base, days: [days[1]], slots: ['dinner'] })
    expect(tomorrow).toEqual(withoutIt)
  })

  /** Plenty of different recipes, so the planner never has to repeat one. */
  const fillers = (n: number) => Array.from({ length: n }, (_, i) => candidate(recipe(`Filler ${i}`, [line('Chicken breast', 300 + i * 20), line('White rice', 100)])))

  it('never makes a lunch the leftovers of last night\'s dinner unless you tagged it', () => {
    const plan = suggestPlan({ ...base, candidates: fillers(24), days, slots: ['lunch', 'dinner'] })
    expect(plan).toHaveLength(days.length * 2) // every meal planned
    const at = (i: number, slot: MealSlot) => plan.find((p) => p.date === days[i] && p.slot === slot)!
    for (let i = 1; i < days.length; i++) expect(at(i, 'lunch').recipeId, `lunch ${i}`).not.toBe(at(i - 1, 'dinner').recipeId)
    // no recipe comes up twice within the 4 days cooked food keeps, which is what would make the second one leftovers
    for (const x of plan) {
      for (const y of plan) {
        if (x !== y && x.recipeId === y.recipeId) expect(Math.abs(daysBetween(x.date, y.date))).toBeGreaterThan(4)
      }
    }
    // so every meal is its own cook
    const sessions = cookSessions(plan.map((p, i) => ({ ...p, id: 1000 + i })), 4)
    expect(sessions.every((x) => x.entries.length === 1)).toBe(true)
  })

  it('still makes leftovers of a lunch you tagged as leftovers', () => {
    const lunch: MealPlanEntry = { id: 777, date: days[1], slot: 'lunch', servingsPlanned: 1, status: 'planned', constraint: 'leftovers' }
    const r = planWeek({ ...base, candidates: fillers(10), days: [days[0], days[1]], slots: ['dinner'], existing: [lunch] })
    const dinner = r.add.find((p) => p.date === days[0] && p.slot === 'dinner')!
    expect(r.update).toEqual([{ id: lunch.id, recipeId: dinner.recipeId, servingsPlanned: 1 }])
  })

  it('does not reuse a dinner you planned yourself as the next day\'s untagged lunch', () => {
    const plan = suggestPlan({ ...base, days: [days[1]], slots: ['lunch'], existing: [entry(days[0], 'dinner', chicken.recipe.id)] })
    expect(plan).toHaveLength(1)
    expect(plan[0].recipeId).not.toBe(chicken.recipe.id)
  })

  it('with too few recipes to avoid repeating one, leaves the extra meals open and says why, instead of making them leftovers', () => {
    const r = planWeek({ ...base, candidates: [chicken, beef], days: [days[0], days[1]], slots: ['lunch', 'dinner'] })
    expect(r.add).toHaveLength(2) // two recipes, two different meals
    expect(r.unresolved).toHaveLength(2)
    expect(r.unresolved[0].reason).toMatch(/would be leftovers/)
    expect(r.unresolved[0].reason).toMatch(/Tag it as leftovers/)
  })

  it('prefers the recipe your pantry covers fully over one it covers only a little', () => {
    // Chicken and rice comes first alphabetically, so only fuller coverage can make Salmon win.
    const longLife = '2026-12-30'
    const pantry = [
      stock('Chicken breast', 20, longLife), stock('White rice', 20, longLife), stock('Broccoli', 20, longLife),
      stock('Salmon', 2000, longLife), stock('Potato', 2000, longLife), stock('Green beans', 1000, longLife),
    ]
    const plan = suggestPlan({ ...base, candidates: [chicken, salmon], days: [TODAY], slots: ['dinner'], pantry })
    expect(plan[0].recipeId).toBe(salmon.recipe.id)
  })

  it('does not plan leftovers for a recipe that makes too few servings', () => {
    const small = candidate(recipe('Single portion', [line('Salmon', 150)], { servings: 1 }))
    const options = [small, chicken, beef, lentils]
    // a one-serving dinner is already planned for tonight: there is nothing left over for tomorrow's lunch
    const plan = suggestPlan({ ...base, candidates: options, days: [days[1]], slots: ['lunch'], existing: [entry(days[0], 'dinner', small.recipe.id)] })
    expect(plan).toHaveLength(1)
    expect(plan[0].recipeId).not.toBe(small.recipe.id)
  })

  it('suggests nothing when no recipe suits the meal', () => {
    expect(suggestPlan({ ...base, candidates: [cake], days, slots: ['dinner'] })).toEqual([])
    expect(suggestPlan({ ...base, candidates: [], days, slots: ['dinner'] })).toEqual([])
  })

  it('plans the number of servings you eat in a meal', () => {
    const big = candidate(recipe('Big eater', [line('Beef chuck roast', 800), line('Potato', 600)], { servings: 4, servingsPerMeal: 2 }))
    const plan = suggestPlan({ ...base, candidates: [big], days: [TODAY], slots: ['dinner'] })
    expect(plan[0]).toMatchObject({ recipeId: big.recipe.id, servingsPlanned: 2 })
  })
})

describe('amounts as you would buy them', () => {
  it('shows pieces for eggs, millilitres for liquids and grams for the rest', async () => {
    const { formatBuy } = await import('./shopping')
    expect(formatBuy(food('Eggs'), 150, true)).toBe('3 pieces')
    expect(formatBuy(food('Eggs'), 160, true)).toBe('4 pieces') // never fewer than you need
    expect(formatBuy(food('Eggs'), 150, false)).toBe('150 g') // used by weight somewhere, so shown by weight
    expect(formatBuy(food('Whole milk'), 515, false)).toBe('500 ml') // 515 g of milk is about 500 ml
    expect(formatBuy(food('Chicken breast'), 612, false)).toBe('610 g')
    expect(formatBuy(food('Rolled oats'), 1250, false)).toBe('1.25 kg')
  })
})
