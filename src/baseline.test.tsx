// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import recipeSeed from './data/recipes.seed.json'
import { db, MealPlannerDB } from './db'
import { recipeNutrition } from './lib/nutrition'
import { classifyRecipe } from './lib/recipeSafety'
import { seedIfEmpty } from './lib/seed'
import { BASELINE_RECIPES_VERSION, seedBaselineRecipes } from './lib/seedRecipes'
import { tagLevelMap } from './lib/sensitivity'
import type { RecipeIngredient, Sensitivity } from './types'

let n = 0
async function freshDb() {
  const database = new MealPlannerDB(`baseline-${n++}`)
  await seedIfEmpty(database)
  return database
}

describe('the baseline recipe set', () => {
  it('adds a useful number of recipes, once', async () => {
    const database = await freshDb()
    const added = await seedBaselineRecipes(database)
    expect(added).toBeGreaterThan(100)
    expect(await database.recipes.count()).toBe(added)
    expect((await database.settings.get(1))?.baselineRecipesVersion).toBe(BASELINE_RECIPES_VERSION)
    expect(await seedBaselineRecipes(database)).toBe(0) // second start adds nothing
    expect(await database.recipes.count()).toBe(added)
  })

  it('adds every recipe in the file, since all their foods exist', async () => {
    const database = await freshDb()
    expect(await seedBaselineRecipes(database)).toBe(recipeSeed.length)
  })

  it('every ingredient is a real food with a usable amount that converts to grams', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const byId = new Map((await database.ingredients.toArray()).map((i) => [i.id!, i]))
    for (const r of await database.recipes.toArray()) {
      expect(r.ingredients.length, r.title).toBeGreaterThan(0)
      expect(r.steps.length, r.title).toBeGreaterThan(0)
      for (const l of r.ingredients) {
        expect(byId.has(l.ingredientId), `${r.title}: unknown food`).toBe(true)
        expect(l.qty, `${r.title}: ${byId.get(l.ingredientId)?.name}`).toBeGreaterThan(0)
      }
      const n = recipeNutrition(r, byId)
      expect(n.uncounted, `${r.title} has an amount with no weight`).toEqual([])
      // sanity: a serving is between a snack and a very large meal
      // a pickle or a dressing can be a few calories a serving, so the floor is low
      expect(n.kcalPerServing, r.title).toBeGreaterThan(5)
      expect(n.kcalPerServing, r.title).toBeLessThan(2500)
    }
  })

  it('adds meat sauce pasta as a flexible recipe, with its choices and optional lines as foods in this install', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const byName = new Map((await database.ingredients.toArray()).map((i) => [i.name, i.id!]))
    const r = (await database.recipes.filter((x) => x.seedId === 'basic:meat-sauce-pasta').first())!
    expect(r.title).toBe('Meat sauce pasta')
    // one meal for one person: half a box of pasta, half a jar of sauce, 2 sausages and an onion
    expect([r.servings, r.servingsPerMeal, r.servingsEstimated]).toEqual([1, 1, false])
    expect(r.ingredients).toHaveLength(5)
    const [meat, pasta, sauce, onion, garlic] = r.ingredients
    expect(meat).toMatchObject({ ingredientId: byName.get('Pork sausages'), qty: 120, unit: 'g', anyCategory: 'meat', label: 'Meat' })
    expect([pasta.qty, sauce.qty, onion.qty, onion.unit]).toEqual([227, 340, 1, 'piece'])
    expect(pasta.anyOf).toEqual([byName.get('Whole wheat pasta'), byName.get('Gluten-free pasta')])
    expect(sauce.label).toBe('Pasta sauce')
    expect([onion.ingredientId, onion.optional, garlic.ingredientId, garlic.optional]).toEqual([byName.get('Onion'), true, byName.get('Garlic'), true])
  })

  it('brings meat sauce pasta to an install that already has the previous release', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    await database.recipes.filter((x) => x.seedId === 'basic:meat-sauce-pasta').delete()
    const ids = (await database.settings.get(1))!.baselineSeedIds!.filter((s) => s !== 'basic:meat-sauce-pasta')
    await database.settings.update(1, { baselineRecipesVersion: 9, baselineSeedIds: ids })
    expect(await seedBaselineRecipes(database)).toBe(1)
    expect(await database.recipes.filter((x) => x.seedId === 'basic:meat-sauce-pasta').count()).toBe(1)
  })

  describe('an install with the first, 4-serving meat sauce pasta', () => {
    async function withFirstVersion(change?: (lines: RecipeIngredient[], byName: Map<string, number>) => RecipeIngredient[]) {
      const database = await freshDb()
      await seedBaselineRecipes(database)
      const byName = new Map((await database.ingredients.toArray()).map((i) => [i.name, i.id!]))
      const id = (n: string) => byName.get(n)!
      let first: RecipeIngredient[] = [
        { ingredientId: id('Ground beef (80/20)'), qty: 450, unit: 'g', label: 'Meat', anyCategory: 'meat' },
        { ingredientId: id('Wheat pasta'), qty: 340, unit: 'g', label: 'Pasta', anyOf: [id('Whole wheat pasta'), id('Gluten-free pasta')] },
        { ingredientId: id('Tomato sauce'), qty: 680, unit: 'g', label: 'Pasta sauce', anyOf: [id('Canned tomatoes')] },
        { ingredientId: id('Onion'), qty: 1, unit: 'piece', optional: true },
        { ingredientId: id('Garlic'), qty: 3, unit: 'piece', optional: true },
        { ingredientId: id('Olive oil'), qty: 1, unit: 'tbsp' },
      ]
      if (change) first = change(first, byName)
      const r = (await database.recipes.filter((x) => x.seedId === 'basic:meat-sauce-pasta').first())!
      await database.recipes.update(r.id!, { ingredients: first, servings: 4, estMinutes: 30 })
      await database.settings.update(1, { baselineRecipesVersion: 10 })
      await seedBaselineRecipes(database)
      return { recipe: (await database.recipes.get(r.id!))!, id }
    }

    it('becomes 1 serving with the new amounts', async () => {
      const { recipe, id } = await withFirstVersion()
      expect(recipe.servings).toBe(1)
      expect(recipe.estMinutes).toBe(25)
      expect(recipe.ingredients.map((l) => [l.ingredientId, l.qty])).toEqual([
        [id('Pork sausages'), 120], [id('Wheat pasta'), 227], [id('Tomato sauce'), 340], [id('Onion'), 1], [id('Garlic'), 2],
      ])
    })

    it('keeps a meat you picked', async () => {
      const { recipe, id } = await withFirstVersion((lines, byName) => [{ ...lines[0], ingredientId: byName.get('Chicken thigh')!, picked: true }, ...lines.slice(1)])
      expect(recipe.servings).toBe(1)
      expect(recipe.ingredients[0]).toMatchObject({ ingredientId: id('Chicken thigh'), qty: 120, picked: true })
    })

    it('is left alone when you changed its amounts', async () => {
      const { recipe } = await withFirstVersion((lines) => [{ ...lines[0], qty: 300 }, ...lines.slice(1)])
      expect(recipe.servings).toBe(4)
      expect(recipe.ingredients[0].qty).toBe(300)
    })
  })

  it('keeps a deleted recipe deleted, even when a later release adds new ones', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const first = (await database.recipes.toArray())[0]
    await database.recipes.delete(first.id!)

    await seedBaselineRecipes(database) // same release: nothing
    expect(await database.recipes.filter((r) => r.seedId === first.seedId).count()).toBe(0)

    // simulate a later release by lowering the stored version
    await database.settings.update(1, { baselineRecipesVersion: 0 })
    expect(await seedBaselineRecipes(database)).toBe(0)
    expect(await database.recipes.filter((r) => r.seedId === first.seedId).count()).toBe(0)
  })

  it('does not overwrite a recipe you edited', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const r = (await database.recipes.toArray())[0]
    await database.recipes.update(r.id!, { title: 'My version', servings: 9 })
    await database.settings.update(1, { baselineRecipesVersion: 0 })
    await seedBaselineRecipes(database)
    const after = await database.recipes.get(r.id!)
    expect(after).toMatchObject({ title: 'My version', servings: 9 })
    expect(await database.recipes.filter((x) => x.seedId === r.seedId).count()).toBe(1)
  })

  it('gluten set to Major hides exactly the recipes that contain a gluten food', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const foods = await database.ingredients.toArray()
    const byId = new Map(foods.map((i) => [i.id!, i]))
    const levels = tagLevelMap([{ tag: 'gluten', sensitivity: 'major' as Sensitivity }])
    const recipes = await database.recipes.toArray()
    let excluded = 0
    for (const r of recipes) {
      const hasGluten = r.ingredients.some((l) => byId.get(l.ingredientId)!.tags.includes('gluten'))
      const status = classifyRecipe(r, byId, levels, 0.25).status
      expect(status === 'excluded', r.title).toBe(hasGluten)
      if (hasGluten) excluded++
    }
    // flour, pasta, soy sauce and bread are common, so a real share of recipes are affected, but not all
    expect(excluded).toBeGreaterThan(20)
    expect(excluded).toBeLessThan(recipes.length)
  })

  it('nothing is excluded or warned when no sensitivities are set', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const byId = new Map((await database.ingredients.toArray()).map((i) => [i.id!, i]))
    for (const r of await database.recipes.toArray()) {
      expect(classifyRecipe(r, byId, new Map(), 0.25).status, r.title).toBe('ok')
    }
  })
})

describe('the starter recipes in the app', () => {
  beforeAll(async () => {
    await seedIfEmpty()
    await seedBaselineRecipes()
  })
  afterEach(async () => {
    cleanup()
    await db.tagSensitivities.clear()
  })

  const open = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )

  it('lists them, and searches by name', async () => {
    open('/recipes')
    expect(await screen.findByText(/to cook\./)).toBeTruthy()
    const search = screen.getByLabelText('Search recipes')
    const title = recipeSeed[0].title
    fireEvent.change(search, { target: { value: title } })
    expect((await screen.findAllByText(title)).length).toBeGreaterThan(0)
    fireEvent.change(search, { target: { value: 'zzzz no such recipe' } })
    expect(await screen.findByText(/No recipes match/)).toBeTruthy()
  })

  it('shows where a starter recipe came from, and says when its servings are a guess', async () => {
    const r = (await db.recipes.filter((x) => x.servingsEstimated === true).first())!
    open(`/recipes/${r.id}`)
    expect(await screen.findByText(/A starter recipe/)).toBeTruthy()
    expect(screen.getByText(/The number of servings is a guess/)).toBeTruthy()
    const link = screen.getByRole('link', { name: /Original recipe/ }) as HTMLAnchorElement
    expect(link.href).toMatch(/^https?:\/\//)
    expect(link.rel).toContain('noopener')
  })

  it('says the servings come from the original recipe when the page published them', async () => {
    const r = (await db.recipes.filter((x) => x.servingsEstimated === false && x.timeEstimated === false).first())!
    open(`/recipes/${r.id}`)
    expect(await screen.findByText(/The servings come from the original recipe/)).toBeTruthy()
    expect(screen.queryByText(/is a guess/)).toBeNull()
    expect(screen.queryByText(/\(guess\)/)).toBeNull()
    expect(screen.queryByText(/cooking time is an estimate/)).toBeNull()
  })

  it('most starter recipes now have the servings published by their original page, and the rest are marked as guesses', async () => {
    const all = await db.recipes.toArray()
    const fromSource = all.filter((r) => r.servingsEstimated === false)
    expect(fromSource.length).toBeGreaterThan(60)
    expect(all.every((r) => typeof r.servingsEstimated === 'boolean')).toBe(true)
    for (const r of fromSource) expect(r.servings, r.title).toBeGreaterThanOrEqual(1)
  })

  it('hides recipes that break a Major sensitivity and counts them', async () => {
    await db.tagSensitivities.put({ tag: 'gluten', sensitivity: 'major' })
    open('/recipes')
    expect(await screen.findByText(/hidden by your sensitivities/)).toBeTruthy()
  })
})

describe('servings guesses and sides missing from the ingredients', () => {
  let thai: { id: number; ingredients: import('./types').RecipeIngredient[] }

  beforeAll(async () => {
    await seedIfEmpty()
    await seedBaselineRecipes()
    const r = (await db.recipes.filter((x) => x.title === 'Thai beef stir-fry').first())!
    thai = { id: r.id!, ingredients: r.ingredients }
  })
  afterEach(async () => {
    cleanup()
    await db.tagSensitivities.clear()
    // put the recipe back as it was seeded, since tests change it
    await db.recipes.update(thai.id, { servings: 4, servingsEstimated: true, ingredients: thai.ingredients })
  })

  const open = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )

  it('seeds Thai beef stir-fry with the 4 servings and 10 minutes its original page publishes, and matches its 22 g protein', async () => {
    await db.recipes.update(thai.id, { servingsEstimated: false, timeEstimated: false, estMinutes: 10 }) // as seeded from the source
    open(`/recipes/${thai.id}`)
    expect(await screen.findByRole('heading', { name: 'Thai beef stir-fry' })).toBeTruthy()
    expect(screen.getByText('22')).toBeTruthy() // g protein per serving; published: 22
    expect(servingsShown()).toBe('4') // the one servings control
    expect(within(statsRow()).getByText('10')).toBeTruthy() // minutes
    expect(screen.getByText(/The servings come from the original recipe/)).toBeTruthy()
    expect(screen.queryByText(/\(guess\)/)).toBeNull()
  })

  it('shows a guessed serving count as a guess, so you know to check it', async () => {
    await db.recipes.update(thai.id, { servingsEstimated: true })
    open(`/recipes/${thai.id}`)
    expect(await screen.findByText(/Servings \(guess\)/)).toBeTruthy()
    expect(screen.getByText(/The number of servings is a guess/)).toBeTruthy()
  })

  it('has one servings control, with an Edit serving size button for the recipe itself', async () => {
    open(`/recipes/${thai.id}`)
    await screen.findByRole('heading', { name: 'Thai beef stir-fry' })
    expect(screen.queryByText('Cook for')).toBeNull() // no second, differently named servings
    expect(within(statsRow()).queryAllByRole('button')).toHaveLength(0) // the stats are just numbers now
    expect(servingsShown()).toBe('4')
    expect(screen.getByRole('button', { name: 'Edit serving size' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Edit serving size' })).toBeNull() // the editor stays closed until asked for
    expect(screen.queryByText(/The recipe makes/)).toBeNull() // no wordy explanation of two numbers
  })

  it('cooking more servings does not change what the recipe makes', async () => {
    open(`/recipes/${thai.id}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Cook more servings' }))
    await waitFor(() => expect(servingsShown()).toBe('5'))
    expect((await db.recipes.get(thai.id))!.servings).toBe(4) // only what is shown changed
  })

  it('lets you correct the serving size, which also stops calling it a guess', async () => {
    await db.recipes.update(thai.id, { servingsEstimated: true })
    open(`/recipes/${thai.id}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit serving size' }))
    const editor = screen.getByRole('group', { name: 'Edit serving size' })
    expect(within(editor).getByText('This recipe makes')).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: 'More servings in the recipe' }))
    await waitFor(async () => expect(await db.recipes.get(thai.id)).toMatchObject({ servings: 5, servingsEstimated: false }))
    await waitFor(() => expect(screen.queryByText(/\(guess\)/)).toBeNull()) // the screen follows the saved change
    await waitFor(() => expect(screen.queryByText(/The number of servings is a guess/)).toBeNull())
    await waitFor(() => expect(servingsShown()).toBe('5')) // the servings shown follow the recipe
    fireEvent.click(within(editor).getByRole('button', { name: 'Fewer servings in the recipe' }))
    await waitFor(async () => expect((await db.recipes.get(thai.id))!.servings).toBe(4))
    fireEvent.click(within(editor).getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('group', { name: 'Edit serving size' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit serving size' })).toBeTruthy()
  })

  it('does not let the serving size go below one', async () => {
    await db.recipes.update(thai.id, { servings: 1 })
    open(`/recipes/${thai.id}`)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit serving size' }))
    expect((screen.getByRole('button', { name: 'Fewer servings in the recipe' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('points out that rice is in the steps but not the ingredients, and adds it on request', async () => {
    open(`/recipes/${thai.id}`)
    expect(await screen.findByText(/serve with rice, but it isn't in the ingredients/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add 300 g white rice \(4 × 75 g raw\)/ }))
    await screen.findByText('White rice') // wait for the ingredient list to update
    const after = await db.recipes.get(thai.id)
    expect(after!.ingredients).toHaveLength(thai.ingredients.length + 1)
    expect(after!.ingredients.at(-1)).toMatchObject({ qty: 300, unit: 'g' })
    expect(screen.queryByText(/but it isn't in the ingredients/)).toBeNull()
    // 300 g raw rice adds 1095 kcal over 4 servings, so about 274 more per serving: well above the 191 before
    expect(screen.queryByText('191')).toBeNull()
  })

  it('warns when the missing side is a sensitivity, because the safety check cannot see it', async () => {
    await db.tagSensitivities.put({ tag: 'gluten', sensitivity: 'major' })
    const beef = (await db.ingredients.where('name').equals('Beef chuck roast').first())!
    const id = (await db.recipes.add({
      title: 'Beef with noodles',
      servings: 2,
      servingsPerMeal: 1,
      ingredients: [{ ingredientId: beef.id!, qty: 300, unit: 'g' }],
      steps: ['Fry the beef.', 'Serve over noodles.'],
      estMinutes: 20,
      actualMinutesHistory: [],
    })) as number
    open(`/recipes/${id}`)
    expect(await screen.findByText(/Wheat pasta is a Major sensitivity for you/)).toBeTruthy()
    expect(screen.queryByText('Not recommended for you')).toBeNull() // the app cannot see it yet, which is exactly why it warns
    await db.recipes.delete(id)
  })
})

describe('upgrading from the first release of the starter recipes', () => {
  it('replaces the old servings guess, keeps a number you changed, and keeps deleted recipes deleted', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const foods = new Map((await database.ingredients.toArray()).map((i) => [i.id!, i]))
    const all = await database.recipes.toArray()
    const [untouched, edited, deleted] = [all[0], all[1], all[2]]

    // Put the database back into its first-release state: guess = calories / 600, no flag, version 1.
    const { legacyServingsGuess } = await import('./lib/guessServings')
    for (const r of all) {
      const total = recipeNutrition({ ...r, servings: 1 }, foods).totalKcal
      await database.recipes.update(r.id!, { servings: legacyServingsGuess(total), servingsEstimated: undefined })
    }
    await database.recipes.update(edited.id!, { servings: 11 }) // you set this one yourself
    await database.recipes.delete(deleted.id!)
    await database.settings.update(1, { baselineRecipesVersion: 1 })

    expect(await seedBaselineRecipes(database)).toBe(0) // nothing new to add

    const seedBy = new Map(recipeSeed.map((s) => [s.seedId, s]))
    const u = (await database.recipes.get(untouched.id!))!
    expect(u.servings).toBe(seedBy.get(u.seedId!)!.servings)
    expect(u.servingsEstimated).toBe(seedBy.get(u.seedId!)!.servingsEstimated ?? true) // false if the page published it

    const e = (await database.recipes.get(edited.id!))!
    expect(e.servings).toBe(11)
    expect(e.servingsEstimated).toBe(false)

    expect(await database.recipes.get(deleted.id!)).toBeUndefined()
    expect((await database.settings.get(1))?.baselineRecipesVersion).toBe(BASELINE_RECIPES_VERSION)
  })
})

describe('bringing published servings and times to an install that has the guesses', () => {
  it('replaces guessed values from the original page, but never a value you changed', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const seedBy = new Map(recipeSeed.map((s) => [s.seedId, s]))
    const published = (await database.recipes.toArray()).filter((r) => {
      const s = seedBy.get(r.seedId!)!
      return s.servingsEstimated === false && s.timeEstimated === false
    })
    expect(published.length).toBeGreaterThan(20)
    const [plain, setServings, setTime] = published

    // Put the database back into how version 2 left it: guessed servings, and the 45 minute placeholder.
    for (const r of published) await database.recipes.update(r.id!, { servings: 3, servingsEstimated: true, estMinutes: 45, timeEstimated: undefined })
    await database.recipes.update(setServings.id!, { servings: 9, servingsEstimated: false }) // you set the servings
    await database.recipes.update(setTime.id!, { estMinutes: 20 }) // you changed the time
    await database.settings.update(1, { baselineRecipesVersion: 2 })

    expect(await seedBaselineRecipes(database)).toBe(0)

    const check = async (r: { id?: number }) => {
      const now = (await database.recipes.get(r.id!))!
      return { now, seed: seedBy.get(now.seedId!)! }
    }
    const a = await check(plain)
    expect(a.now).toMatchObject({ servings: a.seed.servings, servingsEstimated: false, estMinutes: a.seed.estMinutes, timeEstimated: false })

    const b = await check(setServings)
    expect(b.now).toMatchObject({ servings: 9, servingsEstimated: false }) // your number is kept
    expect(b.now.estMinutes).toBe(b.seed.estMinutes) // the time was still the placeholder, so it is updated

    const c = await check(setTime)
    expect(c.now.servings).toBe(c.seed.servings)
    expect(c.now.estMinutes).toBe(20) // your time is kept
    expect((await database.settings.get(1))?.baselineRecipesVersion).toBe(BASELINE_RECIPES_VERSION)
  })
})

describe('sorting the starter recipes by ingredient', () => {
  let byId: Map<number, import('./types').Ingredient>
  let recipes: import('./types').Recipe[]

  beforeAll(async () => {
    await seedIfEmpty()
    await seedBaselineRecipes()
    byId = new Map((await db.ingredients.toArray()).map((i) => [i.id!, i]))
    recipes = await db.recipes.toArray()
  })
  afterEach(async () => {
    cleanup()
    await db.tagSensitivities.clear()
  })

  const open = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    )

  it('every filter has recipes in it, and Vegetarian never contains meat, fish or a hidden animal product', async () => {
    const { recipeKinds, KIND_FILTERS } = await import('./lib/recipeFilters')
    for (const k of KIND_FILTERS) {
      expect(recipes.filter((r) => recipeKinds(r, byId).has(k.id)).length, k.label).toBeGreaterThan(3)
    }
    for (const r of recipes) {
      const kinds = recipeKinds(r, byId)
      if (!kinds.has('vegetarian')) continue
      for (const l of r.ingredients) {
        const food = byId.get(l.ingredientId)!
        expect(['meat', 'seafood'], `${r.title}: ${food.name}`).not.toContain(food.category)
        expect(food.name, `${r.title}`).not.toMatch(/chicken broth|beef broth|bouillon|fish sauce|worcestershire|oyster/i)
      }
      expect(kinds.size, r.title).toBe(1) // vegetarian and a meat group never go together
    }
  })

  it('shows a count on each button and filters to just that kind when tapped', async () => {
    const { recipeKinds } = await import('./lib/recipeFilters')
    open('/recipes')
    const beef = await screen.findByRole('button', { name: /^Beef\d+$/ })
    const expected = recipes.filter((r) => recipeKinds(r, byId).has('beef')).length
    expect(beef.textContent).toBe(`Beef${expected}`)

    fireEvent.click(beef)
    expect(beef.getAttribute('aria-pressed')).toBe('true')
    expect(await screen.findByText('Thai beef stir-fry')).toBeTruthy()
    expect(screen.getByText(new RegExp(`Showing ${expected} of ${recipes.length}`))).toBeTruthy()
    const chickenOnly = recipes.find((r) => {
      const k = recipeKinds(r, byId)
      return k.has('chicken') && !k.has('beef')
    })!
    expect(screen.queryByText(chickenOnly.title)).toBeNull()

    fireEvent.click(beef) // tapping again clears it
    expect(beef.getAttribute('aria-pressed')).toBe('false')
    expect(await screen.findByText(chickenOnly.title)).toBeTruthy()
  })

  it('searches by ingredient, and combines the search with a button', async () => {
    const { matchesSearch, recipeKinds } = await import('./lib/recipeFilters')
    open('/recipes')
    const search = await screen.findByLabelText('Search recipes')
    fireEvent.change(search, { target: { value: 'oyster sauce' } }) // an ingredient, not in any title
    expect(await screen.findByText('Thai beef stir-fry')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'rice' } })
    const withRice = recipes.filter((r) => matchesSearch(r, 'rice', byId))
    expect(withRice.length).toBeGreaterThan(3)
    expect(await screen.findByText(new RegExp(`Showing ${withRice.length} of`))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Beef\d+$/ }))
    const both = recipes.filter((r) => matchesSearch(r, 'rice', byId) && recipeKinds(r, byId).has('beef'))
    expect(await screen.findByText(new RegExp(`Showing ${both.length} of`))).toBeTruthy()
  })

  it('sorts recipes into pasta, soup and rice bowls from their names and ingredients', async () => {
    const { recipeDishes, DISH_FILTERS } = await import('./lib/recipeFilters')
    const dishesOf = (title: string) => recipeDishes(recipes.find((r) => r.title === title)!, byId)
    expect(dishesOf('Spaghetti with meat sauce').has('pasta')).toBe(true)
    expect(dishesOf('Lasagne').has('pasta')).toBe(true)
    expect(dishesOf('French Onion Soup').has('soup')).toBe(true)
    expect(dishesOf('Clam chowder').has('soup')).toBe(true)
    expect(dishesOf('Ground beef rice bowl').has('riceBowl')).toBe(true)
    expect(dishesOf('Jerk chicken with rice & peas').has('riceBowl')).toBe(true)
    // rice in the filling is not a rice bowl, a little pasta in a dish is not a pasta dish, and a rice soup stays a soup
    expect(dishesOf('Golabki (cabbage roll)').has('riceBowl')).toBe(false)
    expect(dishesOf('Egyptian Fatteh').has('pasta')).toBe(false)
    expect(dishesOf('Chicken and broccoli pasta').has('soup')).toBe(false)
    for (const d of DISH_FILTERS) expect(recipes.filter((r) => recipeDishes(r, byId).has(d.id)).length, d.label).toBeGreaterThan(3)
  })

  it('has a separate row of dish buttons, split from the main ingredients by a line', async () => {
    open('/recipes')
    const row = await screen.findByRole('group', { name: 'Filter by dish type' })
    expect(row.className).toContain('filters-dish') // the thin line above it
    expect(within(row).getAllByRole('button').map((b) => b.textContent?.replace(/\d+$/, ''))).toEqual(['Pasta', 'Soup', 'Rice bowl'])
    expect(screen.getByRole('group', { name: 'Filter by main ingredient' })).not.toBe(row)
  })

  it('filters by dish type, and combines it with a main ingredient', async () => {
    const { recipeDishes, recipeKinds } = await import('./lib/recipeFilters')
    open('/recipes')
    const pasta = await screen.findByRole('button', { name: /^Pasta\d+$/ })
    fireEvent.click(pasta)
    expect(pasta.getAttribute('aria-pressed')).toBe('true')
    const pastas = recipes.filter((r) => recipeDishes(r, byId).has('pasta'))
    expect(await screen.findByText(new RegExp(`Showing ${pastas.length} of`))).toBeTruthy()
    expect(screen.queryByText('Thai beef stir-fry')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /^Beef\d+$/ }))
    const beefPastas = pastas.filter((r) => recipeKinds(r, byId).has('beef'))
    expect(beefPastas.length).toBeGreaterThan(0)
    expect(await screen.findByText(new RegExp(`Showing ${beefPastas.length} of`))).toBeTruthy()
    expect(screen.getByText('Spaghetti with meat sauce')).toBeTruthy()
    expect(screen.queryByText('Tuna pasta')).toBeNull()
  })

  it('adjusts the numbers on the other buttons to what would be left, so Beef then shows how many beef pastas there are', async () => {
    const { recipeDishes, recipeKinds } = await import('./lib/recipeFilters')
    open('/recipes')
    const count = (name: RegExp) => Number((screen.getByRole('button', { name }).textContent ?? '').replace(/\D+/g, ''))
    await screen.findByRole('button', { name: /^Beef\d+$/ })
    const allPasta = recipes.filter((r) => recipeDishes(r, byId).has('pasta')).length
    expect(count(/^Pasta\d+$/)).toBe(allPasta) // nothing selected: every pasta

    fireEvent.click(screen.getByRole('button', { name: /^Beef\d+$/ }))
    const beefPasta = recipes.filter((r) => recipeKinds(r, byId).has('beef') && recipeDishes(r, byId).has('pasta')).length
    const beefSoup = recipes.filter((r) => recipeKinds(r, byId).has('beef') && recipeDishes(r, byId).has('soup')).length
    const beefRice = recipes.filter((r) => recipeKinds(r, byId).has('beef') && recipeDishes(r, byId).has('riceBowl')).length
    await waitFor(() => expect(count(/^Pasta\d+$/)).toBe(beefPasta))
    expect(beefPasta).toBeLessThan(allPasta)
    expect(count(/^Soup\d+$/)).toBe(beefSoup)
    expect(count(/^Rice bowl\d+$/)).toBe(beefRice)

    // the other way: with Pasta on, the main ingredient numbers become pasta counts. The selected button's own group counts too.
    fireEvent.click(screen.getByRole('button', { name: /^Beef\d+$/ })) // off
    fireEvent.click(screen.getByRole('button', { name: /^Pasta\d+$/ }))
    const pastaChicken = recipes.filter((r) => recipeDishes(r, byId).has('pasta') && recipeKinds(r, byId).has('chicken')).length
    await waitFor(() => expect(count(/^Chicken\d+$/)).toBe(pastaChicken))
    const pastaVeg = recipes.filter((r) => recipeDishes(r, byId).has('pasta') && recipeKinds(r, byId).has('vegetarian')).length
    expect(count(/^Vegetarian\d+$/)).toBe(pastaVeg)
    // clearing the filters brings the full numbers back
    fireEvent.click(screen.getByRole('button', { name: /^Pasta\d+$/ }))
    await waitFor(() => expect(count(/^Pasta\d+$/)).toBe(allPasta))
  })

  it('says what is missing and offers a way back when nothing matches', async () => {
    open('/recipes')
    fireEvent.click(await screen.findByRole('button', { name: /^Vegetarian\d+$/ }))
    // salmon cannot be in a vegetarian recipe. (Not "beef": the source files a vegetable shepherd's pie under Beef.)
    fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'salmon' } })
    expect(await screen.findByText(/No vegetarian recipes match “salmon”/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'clear the filters' }))
    expect(await screen.findByText('Thai beef stir-fry')).toBeTruthy()
  })

  it('counts only recipes you can cook, so the numbers match what you will see', async () => {
    const { recipeKinds } = await import('./lib/recipeFilters')
    await db.tagSensitivities.put({ tag: 'gluten', sensitivity: 'major' })
    open('/recipes')
    const { classifyRecipe } = await import('./lib/recipeSafety')
    const levels = new Map([['gluten', 'major' as const]])
    const cookable = recipes.filter((r) => classifyRecipe(r, byId, levels, 0.25).status !== 'excluded' && recipeKinds(r, byId).has('chicken'))
    const all = recipes.filter((r) => recipeKinds(r, byId).has('chicken'))
    expect(cookable.length).toBeLessThan(all.length) // gluten removes some chicken recipes
    expect((await screen.findByRole('button', { name: /^Chicken\d+$/ })).textContent).toBe(`Chicken${cookable.length}`)
  })
})

/** The row of numbers under the title (protein, kcal, minutes, servings), as opposed to the scaling panel. */
function servingsShown(): string | null {
  return document.querySelector('.scale-main .stat-num')?.textContent ?? null
}

function statsRow(): HTMLElement {
  return document.querySelector('.stats') as HTMLElement
}

describe('correcting ingredient amounts the import misread', () => {
  const PIRI = 'themealdb:53039'
  const protein = async (database: MealPlannerDB) => {
    const r = (await database.recipes.filter((x) => x.seedId === PIRI).first())!
    const byId = new Map((await database.ingredients.toArray()).map((i) => [i.id!, i]))
    return { r, perServing: recipeNutrition(r, byId).proteinPerServing, byId }
  }

  it('ships the piri-piri chicken with about 33 g protein a serving, as its page says (not 101 g)', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const { perServing } = await protein(database)
    expect(perServing).toBeGreaterThan(31)
    expect(perServing).toBeLessThan(35)
  })

  it('fixes an install that has the old amounts, but leaves one you changed', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const byName = new Map((await database.ingredients.toArray()).map((i) => [i.name, i.id!]))
    const oldLines = (r: { ingredients: { ingredientId: number; qty: number; unit: string }[] }) =>
      r.ingredients.map((l) =>
        l.ingredientId === byName.get('Chicken thigh') ? { ...l, ingredientId: byName.get('Chicken breast')!, qty: 1500, unit: 'g' }
        : l.ingredientId === byName.get('Cabbage') ? { ...l, qty: 4, unit: 'piece' }
        : l,
      )

    // the install as an earlier release left it
    const { r } = await protein(database)
    await database.recipes.update(r.id!, { ingredients: oldLines(r) as never })
    await database.settings.update(1, { baselineRecipesVersion: 6 })
    expect((await protein(database)).perServing).toBeGreaterThan(95)
    await seedBaselineRecipes(database)
    expect((await protein(database)).perServing).toBeLessThan(35)

    // the same install, but you had already changed the chicken yourself: nothing is touched
    const again = await protein(database)
    const mine = oldLines(again.r).map((l) => (l.qty === 1500 ? { ...l, qty: 800 } : l))
    await database.recipes.update(again.r.id!, { ingredients: mine as never })
    await database.settings.update(1, { baselineRecipesVersion: 6 })
    await seedBaselineRecipes(database)
    expect((await protein(database)).r.ingredients).toEqual(mine)
  })
})

describe('the table of corrections to starter recipes', () => {
  it('is already in the starter data, so a new install needs no correcting', async () => {
    const { SEED_FIXES } = await import('./lib/seedFixes')
    for (const fix of SEED_FIXES) {
      const r = recipeSeed.find((s) => s.seedId === fix.seedId)
      expect(r, fix.title).toBeTruthy()
      for (const l of fix.now ?? []) expect(r!.ingredients, fix.title).toContainEqual(l)
      for (const l of fix.add ?? []) expect(r!.ingredients.map((x) => x.name), fix.title).toContain(l.name)
      for (const l of fix.was ?? []) expect(r!.ingredients, fix.title).not.toContainEqual(l)
      if (fix.servings) expect(r!.servings, fix.title).toBe(fix.servings.now)
    }
  })

  it('corrects an install that has the old servings and ingredients, but not one you changed', async () => {
    const database = await freshDb()
    await seedBaselineRecipes(database)
    const byName = new Map((await database.ingredients.toArray()).map((i) => [i.name, i.id!]))
    const get = async (seedId: string) => (await database.recipes.filter((x) => x.seedId === seedId).first())!

    // as an earlier release left them: pies as 4 servings, and the lobster as six whole ones
    const pies = await get('themealdb:53109')
    const lobster = await get('themealdb:53510')
    const prawns = await get('themealdb:53180')
    await database.recipes.update(pies.id!, { servings: 4, servingsEstimated: true })
    await database.recipes.update(lobster.id!, { ingredients: lobster.ingredients.map((l) => (l.ingredientId === byName.get('Lobster') ? { ...l, qty: 6, unit: 'piece' as const } : l)) })
    await database.recipes.update(prawns.id!, { servings: 5, servingsEstimated: false }) // you set 5 yourself
    await database.settings.update(1, { baselineRecipesVersion: 7 })
    await seedBaselineRecipes(database)

    expect(await get('themealdb:53109')).toMatchObject({ servings: 24, servingsEstimated: false })
    expect((await get('themealdb:53510')).ingredients.find((l) => l.ingredientId === byName.get('Lobster'))).toMatchObject({ qty: 800, unit: 'g' })
    expect((await get('themealdb:53180')).servings).toBe(5) // your number is kept
  })
})
