// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { db } from './db'
import { addDays } from './lib/expiry'
import { todayIso } from './lib/pantry'
import { seedIfEmpty } from './lib/seed'

beforeAll(async () => {
  await seedIfEmpty()
})
afterEach(async () => {
  cleanup()
  await db.recipes.clear()
  await db.pantryItems.clear()
  await db.tagSensitivities.clear()
  await db.ingredients.filter((i) => i.custom === true).delete()
})

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

const sheet = () => within(screen.getByRole('dialog'))
const type = (label: string | RegExp, value: string) => fireEvent.change(sheet().getByLabelText(label), { target: { value } })
const customFoods = () => db.ingredients.filter((i) => i.custom === true).toArray()

/** Fill the sheet with a valid food and save it. */
async function fillAndSave(over: { name?: string; kcal?: string; protein?: string } = {}) {
  if (over.name !== undefined) type('Name', over.name)
  type('Calories (kcal)', over.kcal ?? '345')
  type('Protein (g)', over.protein ?? '17')
  fireEvent.click(sheet().getByRole('button', { name: 'Save food' }))
}

describe('adding a food from the Foods page', () => {
  it('opens a sheet, saves the food, and lists it as yours', async () => {
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Add a food/ }))
    expect(screen.getByRole('dialog', { name: 'Add a food' })).toBeTruthy()
    type('Name', 'Nigella seeds')
    type('What kind of food is it?', 'spices-herbs')
    await fillAndSave()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    const [food] = await customFoods()
    expect(food).toMatchObject({ name: 'Nigella seeds', category: 'spices-herbs', kcalPer100g: 345, proteinPer100g: 17, sensitivity: 'safe', custom: true })
    expect(food.shelfLifeDays).toEqual({ pantry: 730, fridge: 730 }) // the usual for spices, filled in for you

    fireEvent.change(screen.getByLabelText('Search foods'), { target: { value: 'nigella' } })
    expect(await screen.findByText('Nigella seeds')).toBeTruthy()
    expect(screen.getByText('Yours')).toBeTruthy()
  })

  it('reads a per-serving label and shows what it works out to per 100 g', async () => {
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Add a food/ }))
    fireEvent.click(sheet().getByLabelText('Per serving'))
    type('Serving size (g)', '30')
    type('Calories (kcal)', '120')
    type('Protein (g)', '6')
    expect(await sheet().findByText(/Works out to 400 kcal and 20 g protein per 100 g/)).toBeTruthy()
    type('Name', 'Protein bar')
    fireEvent.click(sheet().getByRole('button', { name: 'Save food' }))
    await waitFor(async () => expect((await customFoods())[0]).toMatchObject({ kcalPer100g: 400, proteinPer100g: 20 }))
  })

  it('refuses to save until the problems are fixed, and says what they are', async () => {
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Add a food/ }))
    fireEvent.click(sheet().getByRole('button', { name: 'Save food' }))
    expect(await sheet().findByText('Give the food a name.')).toBeTruthy()
    expect(sheet().getByRole('alert').textContent).toMatch(/Fix the highlighted fields/)
    expect(await customFoods()).toHaveLength(0)

    type('Name', 'Whole milk')
    type('Calories (kcal)', '950')
    fireEvent.click(sheet().getByRole('button', { name: 'Save food' }))
    expect(await sheet().findByText(/already have a food called “Whole milk”/)).toBeTruthy()
    expect(sheet().getByText(/more than any food has/)).toBeTruthy()
    expect(await customFoods()).toHaveLength(0)
  })

  it('suggests allergen tags from the name and warns when none are ticked, but never ticks them itself', async () => {
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Add a food/ }))
    type('Name', 'Shrimp paste')
    expect(await sheet().findByText(/From the name, you may want/)).toBeTruthy()
    expect(sheet().getByText(/treated as safe for you/)).toBeTruthy()
    const shellfish = sheet().getByRole('button', { name: 'Shellfish' })
    expect(shellfish.getAttribute('aria-pressed')).toBe('false') // not ticked for you

    fireEvent.click(sheet().getByRole('button', { name: 'Add Shellfish' }))
    expect(sheet().getByRole('button', { name: 'Shellfish' }).getAttribute('aria-pressed')).toBe('true')
    expect(sheet().queryByRole('button', { name: 'Add Shellfish' })).toBeNull() // no longer suggested
    expect(sheet().queryByText(/treated as safe for you/)).toBeNull()
  })

  it('closes with Escape or Cancel without saving anything', async () => {
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Add a food/ }))
    type('Name', 'Half typed')
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /Add a food/ }))
    fireEvent.click(sheet().getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await customFoods()).toHaveLength(0)
  })
})

describe('a food you added keeps you safe like any other', () => {
  it('is flagged by your sensitivities through its tags', async () => {
    await db.ingredients.add({
      name: 'Seitan', aliases: [], category: 'grains', tags: ['gluten', 'wheat'], shelfLifeDays: { fridge: 7 },
      kcalPer100g: 370, proteinPer100g: 75, sensitivity: 'safe', lightThresholdPct: 0.15, custom: true,
    })
    await db.tagSensitivities.put({ tag: 'gluten', sensitivity: 'major' })
    open('/ingredients')
    fireEvent.change(await screen.findByLabelText('Search foods'), { target: { value: 'seitan' } })
    // only Gluten is set to Major (Wheat is not), so that is the reason shown
    expect(await screen.findByText(/Major because of gluten$/)).toBeTruthy()
  })
})

describe('adding a food in the middle of a recipe', () => {
  it('adds it from a pasted ingredient that did not match, and the recipe uses it', async () => {
    open('/recipes/new')
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Potato salad' } })
    fireEvent.click(screen.getByRole('button', { name: /paste a list/i }))
    fireEvent.change(screen.getByLabelText(/paste ingredients/i), { target: { value: '500 g potatoes\n1 tbsp black onion seeds' } })
    fireEvent.click(screen.getByRole('button', { name: /add to recipe/i }))

    // the seeds did not match any food, so the line offers to add one
    expect(await screen.findByText(/Couldn't find “black onion seeds” in your foods/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Not here\? Add “black onion seeds” as a new food/ }))
    expect((sheet().getByLabelText('Name') as HTMLInputElement).value).toBe('black onion seeds') // pre-filled from what was typed

    type('Name', 'Nigella seeds')
    type('Other names, separated by commas', 'black onion seeds, kalonji')
    await fillAndSave()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // the line now uses the new food, with the amount from the paste, and the recipe was not saved by accident
    expect(await screen.findByText('Nigella seeds')).toBeTruthy()
    expect(await db.recipes.count()).toBe(0)
    const amounts = (screen.getAllByLabelText('Amount') as HTMLInputElement[]).map((i) => i.value)
    expect(amounts).toEqual(['500', '1'])

    fireEvent.click(screen.getByRole('button', { name: /save recipe/i }))
    await waitFor(async () => expect(await db.recipes.count()).toBe(1))
    const recipe = (await db.recipes.toArray())[0]
    const seeds = (await customFoods())[0]
    expect(recipe.ingredients.some((l) => l.ingredientId === seeds.id)).toBe(true)
  })

  it('a food added once is found by its other names in later recipes', async () => {
    await db.ingredients.add({
      name: 'Nigella seeds', aliases: ['black onion seeds', 'kalonji'], category: 'spices-herbs', tags: [],
      shelfLifeDays: { pantry: 730 }, kcalPer100g: 345, proteinPer100g: 17, sensitivity: 'safe', lightThresholdPct: 0.15, custom: true,
    })
    open('/recipes/new')
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Naan' } })
    fireEvent.click(screen.getByRole('button', { name: /paste a list/i }))
    fireEvent.change(screen.getByLabelText(/paste ingredients/i), { target: { value: '1 tbsp black onion seeds' } })
    fireEvent.click(screen.getByRole('button', { name: /add to recipe/i }))
    expect(await screen.findByText('Nigella seeds')).toBeTruthy()
    expect(screen.queryByText(/Couldn't find/)).toBeNull()
  })

  it('lets you add a food from the search box of a line you are filling in by hand', async () => {
    open('/recipes/new')
    fireEvent.click(await screen.findByRole('button', { name: /Add ingredient/ }))
    fireEvent.change(screen.getByPlaceholderText('Search foods'), { target: { value: 'zzz special flour' } })
    fireEvent.click(await screen.findByRole('button', { name: /Add “zzz special flour” as a new food/ }))
    expect(screen.getByRole('dialog', { name: 'Add a food' })).toBeTruthy()
  })
})

describe('adding a food while adding groceries', () => {
  it('adds the food and goes straight on to quantity and storage', async () => {
    open('/pantry')
    fireEvent.click(await screen.findByRole('button', { name: /Add groceries/ }))
    fireEvent.change(screen.getByLabelText('What did you buy?'), { target: { value: 'zzz oat bar' } })
    fireEvent.click(await screen.findByRole('button', { name: /Add “zzz oat bar” as a new food/ }))
    type('Name', 'Oat bar')
    type('What kind of food is it?', 'grains')
    await fillAndSave({ kcal: '420', protein: '9' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // now the pantry form has the new food chosen, and asks how much
    expect(await screen.findByText('Oat bar')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('How much?'), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add to pantry' }))
    await waitFor(async () => expect(await db.pantryItems.count()).toBe(1))
    expect(await db.pantryItems.count()).toBe(1)
  })
})

describe('editing and deleting your own foods', () => {
  const add = (name: string) =>
    db.ingredients.add({
      name, aliases: [], category: 'pantry', tags: [], shelfLifeDays: { pantry: 100 },
      kcalPer100g: 100, proteinPer100g: 5, sensitivity: 'major', lightThresholdPct: 0.15, custom: true,
    }) as Promise<number>

  it('opens a food to edit and keeps the sensitivity you gave it', async () => {
    await add('Odd bar')
    open('/ingredients')
    fireEvent.change(await screen.findByLabelText('Search foods'), { target: { value: 'odd bar' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Odd bar' }))
    expect(screen.getByRole('dialog', { name: 'Edit food' })).toBeTruthy()
    expect((sheet().getByLabelText('Name') as HTMLInputElement).value).toBe('Odd bar')
    type('Calories (kcal)', '150')
    fireEvent.click(sheet().getByRole('button', { name: 'Save changes' }))
    await waitFor(async () => expect((await customFoods())[0].kcalPer100g).toBe(150))
    expect((await customFoods())[0]).toMatchObject({ sensitivity: 'major', name: 'Odd bar' })
  })

  it('does not offer to edit the built-in foods', async () => {
    open('/ingredients')
    fireEvent.change(await screen.findByLabelText('Search foods'), { target: { value: 'whole milk' } })
    await screen.findByText('Whole milk')
    expect(screen.queryByRole('button', { name: /Edit Whole milk/ })).toBeNull()
  })

  it('deletes a food nothing uses, after asking', async () => {
    await add('Spare food')
    open('/ingredients')
    fireEvent.change(await screen.findByLabelText('Search foods'), { target: { value: 'spare food' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Spare food' }))
    fireEvent.click(await sheet().findByRole('button', { name: 'Delete this food' }))
    expect(await customFoods()).toHaveLength(1) // still there until confirmed
    fireEvent.click(sheet().getByRole('button', { name: 'Yes, delete this food' }))
    await waitFor(async () => expect(await customFoods()).toHaveLength(0))
  })

  it('will not delete a food that a recipe or your pantry uses, and says where', async () => {
    const id = await add('Used food')
    await db.recipes.add({ title: 'Uses it', servings: 2, servingsPerMeal: 1, ingredients: [{ ingredientId: id, qty: 100, unit: 'g' }], steps: ['x'], estMinutes: 10, actualMinutesHistory: [] })
    await db.pantryItems.add({ ingredientId: id, qty: 50, unit: 'g', purchasedOn: todayIso(), expiresOn: addDays(todayIso(), 30), location: 'pantry' })
    open('/ingredients')
    fireEvent.change(await screen.findByLabelText('Search foods'), { target: { value: 'used food' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Used food' }))
    expect(await sheet().findByText(/Used in 1 recipe and 1 pantry item\. Remove it from those before deleting it\./)).toBeTruthy()
    expect(sheet().queryByRole('button', { name: 'Delete this food' })).toBeNull()
    expect(await customFoods()).toHaveLength(1)
  })
})

describe('your foods survive an update of the built-in list', () => {
  it('are not touched, or duplicated, when the food list is refreshed', async () => {
    await db.ingredients.add({
      name: 'My cereal', aliases: [], category: 'grains', tags: ['oats'], shelfLifeDays: { pantry: 200 },
      kcalPer100g: 380, proteinPer100g: 11, sensitivity: 'light', lightThresholdPct: 0.15, custom: true,
    })
    const before = await db.ingredients.count()
    await seedIfEmpty()
    await seedIfEmpty()
    expect(await db.ingredients.count()).toBe(before)
    expect((await customFoods())[0]).toMatchObject({ name: 'My cereal', sensitivity: 'light', kcalPer100g: 380 })
  })
})
