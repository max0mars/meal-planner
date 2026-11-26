// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import ICAL from 'ical.js'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { DEFAULT_SETTINGS, db } from './db'
import { addDays } from './lib/expiry'
import { todayIso } from './lib/pantry'
import { weekDays } from './lib/plan'
import { seedIfEmpty } from './lib/seed'
import type { RecipeIngredient, Unit } from './types'

const TODAY = todayIso()

beforeAll(async () => {
  await seedIfEmpty()
})
// The planner leaves out today's meals whose time has gone, so these tests run at 6 in the morning: nothing has passed yet.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T06:00:00`))
})
afterEach(async () => {
  vi.useRealTimers()
  cleanup()
  await db.recipes.clear()
  await db.pantryItems.clear()
  await db.mealPlan.clear()
  await db.trips.clear()
  await db.tagSensitivities.clear()
  await db.settings.put({ ...DEFAULT_SETTINGS })
})

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

async function line(name: string, qty: number, unit: Unit = 'g'): Promise<RecipeIngredient> {
  const food = (await db.ingredients.where('name').equals(name).first())!
  return { ingredientId: food.id!, qty, unit }
}
async function addRecipe(title: string, lines: Promise<RecipeIngredient>[], over: { servings?: number; servingsPerMeal?: number } = {}) {
  return (await db.recipes.add({
    title, servings: over.servings ?? 4, servingsPerMeal: over.servingsPerMeal ?? 1, ingredients: await Promise.all(lines), steps: ['Cook it.'], estMinutes: 30, actualMinutesHistory: [],
  })) as number
}
/** Three ordinary dinners, each about 300 kcal a serving. */
async function threeRecipes() {
  const chicken = await addRecipe('Chicken and rice', [line('Chicken breast', 400), line('White rice', 200), line('Broccoli', 200)])
  const beef = await addRecipe('Beef stew', [line('Beef chuck roast', 500), line('Potato', 400), line('Carrot', 200), line('Salt', 1, 'tsp'), line('Cumin', 1, 'tsp')])
  const salmon = await addRecipe('Salmon and potatoes', [line('Salmon', 400), line('Potato', 400), line('Green beans', 200), line('Eggs', 2, 'piece')])
  return { chicken, beef, salmon }
}
/** More recipes, so planning six meals never has to repeat one: a repeat within a few days would be leftovers. */
async function fillerRecipes(n = 6) {
  for (let i = 0; i < n; i++) await addRecipe(`Filler ${i}`, [line('Chicken breast', 300 + i * 10), line('White rice', 100 + i * 5)])
}
async function stock(name: string, qty: number, expiresOn: string, unit: Unit = 'g') {
  const food = (await db.ingredients.where('name').equals(name).first())!
  await db.pantryItems.add({ ingredientId: food.id!, qty, unit, purchasedOn: addDays(TODAY, -2), expiresOn, location: 'fridge' })
}

describe('Settings', () => {
  it('shows your targets and saves a change as you type', async () => {
    open('/settings')
    const calories = (await screen.findByLabelText('Calories')) as HTMLInputElement
    expect(calories.value).toBe('3000')
    fireEvent.change(calories, { target: { value: '3500' } })
    await waitFor(async () => expect((await db.settings.get(1))!.kcalTarget).toBe(3500))
    fireEvent.change(screen.getByLabelText('Protein'), { target: { value: '170' } })
    await waitFor(async () => expect((await db.settings.get(1))!.proteinTarget).toBe(170))
  })

  it('refuses a number that is out of range, says so, and keeps the old value', async () => {
    open('/settings')
    fireEvent.change(await screen.findByLabelText('Calories'), { target: { value: '50' } })
    expect(await screen.findByText('Enter a number from 1000 to 6000.')).toBeTruthy()
    expect((await db.settings.get(1))!.kcalTarget).toBe(3000)
  })

  it('toggles meals to plan, but always keeps at least one meal', async () => {
    open('/settings')
    fireEvent.click(await screen.findByRole('button', { name: 'Breakfast' }))
    await waitFor(async () => expect((await db.settings.get(1))!.planSlots).toEqual(['breakfast', 'lunch', 'dinner']))
    fireEvent.click(screen.getByRole('button', { name: 'Lunch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Breakfast' }))
    await waitFor(async () => expect((await db.settings.get(1))!.planSlots).toEqual(['dinner']))
    fireEvent.click(screen.getByRole('button', { name: 'Dinner' })) // the last one stays
    expect((await db.settings.get(1))!.planSlots).toEqual(['dinner'])
  })

  it('the Light-food limit you set decides which recipes are hidden', async () => {
    await db.tagSensitivities.put({ tag: 'onion-garlic', sensitivity: 'light' })
    // 100 g of onion in about 1.1 kg is about 9%: fine at the default 15%, too much at 5%
    await addRecipe('Chicken with onion', [line('Chicken breast', 500), line('White rice', 500), line('Onion', 100)])
    open('/recipes')
    expect(await screen.findByText(/1 to cook\./)).toBeTruthy()
    cleanup()

    open('/settings')
    fireEvent.change(await screen.findByLabelText('One food at most'), { target: { value: '5' } })
    await waitFor(async () => expect((await db.settings.get(1))!.defaultLightThresholdPct).toBeCloseTo(0.05))
    cleanup()

    open('/recipes')
    expect(await screen.findByText(/0 to cook\./)).toBeTruthy()
    expect(screen.getByText(/1 hidden by your sensitivities/)).toBeTruthy()
  })

  it('links to the foods and sensitivities screen', async () => {
    open('/settings')
    const link = (await screen.findByRole('link', { name: /Foods and sensitivities/ })) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/ingredients')
  })
})

const cols = () => document.querySelectorAll<HTMLElement>('.plan-col')
/** The column for the day i days from today, once the plan has loaded. The strip holds days before and after as well. */
const dayCol = (i: number) => document.querySelector<HTMLElement>(`.plan-col[data-date="${addDays(TODAY, i)}"]`)
const col = async (i: number) => {
  await waitFor(() => expect(dayCol(i)).toBeTruthy())
  return within(dayCol(i)!)
}
/** What a 12-hour time field (hour, minute, AM or PM) is set to, as HH:MM. */
const timeValue = (scope: ReturnType<typeof within>, label: string) => {
  const [h, m, p] = within(scope.getByRole('group', { name: label })).getAllByRole('combobox') as HTMLSelectElement[]
  return `${String((Number(h.value) % 12) + (p.value === 'PM' ? 12 : 0)).padStart(2, '0')}:${m.value.padStart(2, '0')}`
}
/** Set a 12-hour time field to HH:MM by choosing its AM or PM, hour and minute. */
const setTime = (scope: ReturnType<typeof within>, label: string, hhmm: string) => {
  const [hh, mm] = hhmm.split(':').map(Number)
  const [h, m, p] = within(scope.getByRole('group', { name: label })).getAllByRole('combobox') as HTMLSelectElement[]
  fireEvent.change(p, { target: { value: hh >= 12 ? 'PM' : 'AM' } })
  fireEvent.change(h, { target: { value: String(hh % 12 === 0 ? 12 : hh % 12) } })
  fireEvent.change(m, { target: { value: String(mm) } })
}
/** The back button on the recipe screen (the tab bar has links with the same names). */
const backLink = () => document.querySelector('a.back') as HTMLAnchorElement
const lastDialog = () => within(screen.getAllByRole('dialog').at(-1)!)
/** The sheet for a meal (not the recipe picker, which can be open on top of it and has the same title). */
const sheetFor = (slot: string) => within(screen.getAllByRole('dialog').find((d) => new RegExp(`^${slot},`, 'i').test(d.querySelector('h2')?.textContent ?? ''))!)
const addMeal = async (i: number, slot: 'lunch' | 'dinner') => fireEvent.click(await (await col(i)).findByRole('button', { name: new RegExp(`^Add ${slot}`) }))

describe('the Plan screen', () => {
  it('shows days side by side in a strip, each with lunch and dinner and a place for groceries before, between and after', async () => {
    open('/plan')
    await screen.findByRole('heading', { name: 'Plan' })
    await col(2)
    expect(cols().length).toBeGreaterThan(3) // a strip you can swipe through, not just three days
    for (const column of [await col(0), await col(1), await col(2)]) {
      expect(column.getByRole('button', { name: /^Add lunch/ })).toBeTruthy()
      expect(column.getByRole('button', { name: /^Add dinner/ })).toBeTruthy()
      expect(column.getByRole('button', { name: /^Add groceries .* before lunch$/ })).toBeTruthy()
      expect(column.getByRole('button', { name: /^Add groceries .* between lunch and dinner$/ })).toBeTruthy()
      expect(column.getByRole('button', { name: /^Add groceries .* after dinner$/ })).toBeTruthy()
    }
    expect((await col(0)).getByText('Today')).toBeTruthy()
    expect((await col(1)).queryByText('Today')).toBeNull()
    expect(screen.queryByText(/meals? planned|to buy\./)).toBeNull() // no summary line under the title
  })

  it('picks a recipe for a meal, and shows its numbers and the day against your targets', async () => {
    await threeRecipes()
    open('/plan')
    await addMeal(0, 'dinner') // an empty meal opens the recipe picker straight away
    fireEvent.click(lastDialog().getByText('Chicken and rice'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()) // choosing closes it

    const first = await col(0)
    expect(await first.findByText('Chicken and rice')).toBeTruthy()
    expect(first.getByText(/^\d+ kcal$/, { selector: '.cell-nums' })).toBeTruthy()
    expect(first.getByLabelText(/calories, .* grams protein/)).toBeTruthy()
    expect((await db.mealPlan.toArray())[0]).toMatchObject({ date: TODAY, slot: 'dinner', servingsPlanned: 1, status: 'planned' })
    expect((await db.mealPlan.toArray())[0].constraint).toBeUndefined()
  })

  it('only offers recipes you can cook, and filters them by main ingredient', async () => {
    await db.tagSensitivities.put({ tag: 'dairy', sensitivity: 'major' })
    await addRecipe('Cheese bake', [line('Cheddar cheese', 300), line('Potato', 500)])
    await threeRecipes()
    open('/plan')
    await addMeal(0, 'dinner')
    const picker = lastDialog()
    expect(picker.getByText('Beef stew')).toBeTruthy()
    expect(picker.queryByText('Cheese bake')).toBeNull() // dairy is Major for you
    fireEvent.click(picker.getByRole('button', { name: /^Beef\d+$/ }))
    expect(picker.queryByText('Chicken and rice')).toBeNull()
    expect(picker.getByText('Beef stew')).toBeTruthy()
    fireEvent.click(picker.getByRole('button', { name: 'Close' }))
    expect(await db.mealPlan.count()).toBe(0)
  })

  /** The text of every filter and sort button inside a container, without their numbers. */
  const filterButtons = (root: ParentNode) => [...root.querySelectorAll('.filters button')].map((b) => b.textContent?.replace(/\d+$/, ''))

  it('has exactly the same search and filter buttons as the Recipes screen', async () => {
    await threeRecipes()
    open('/plan')
    await addMeal(0, 'dinner')
    const inPicker = filterButtons(screen.getAllByRole('dialog').at(-1)!)
    expect(inPicker).toEqual(['Beef', 'Chicken', 'Fish', 'Pork', 'Vegetarian', 'Pasta', 'Soup', 'Rice bowl', 'Your cuisines', 'Liked', 'Most protein'])
    expect(lastDialog().getByRole('searchbox', { name: 'Search recipes' })).toBeTruthy()
    cleanup()
    open('/recipes')
    await screen.findByRole('searchbox', { name: 'Search recipes' })
    expect(filterButtons(document.body)).toEqual(inPicker) // one filter bar, so they cannot differ
  })

  it('filters the picker by dish type and by liked, and adjusts the numbers like the Recipes screen does', async () => {
    const { chicken } = await threeRecipes()
    await addRecipe('Spaghetti bake', [line('Wheat pasta', 300), line('Ground beef (80/20)', 400)])
    await db.recipes.update(chicken, { rating: 'like' })
    open('/plan')
    await addMeal(0, 'dinner')
    const picker = lastDialog()
    const count = (name: RegExp) => Number((picker.getByRole('button', { name }).textContent ?? '').replace(/\D+/g, ''))
    expect(count(/^Pasta\d+$/)).toBe(1)
    expect(count(/^Beef\d+$/)).toBe(2) // the stew and the beef pasta

    fireEvent.click(picker.getByRole('button', { name: /^Pasta\d+$/ }))
    expect(picker.getByText('Spaghetti bake')).toBeTruthy()
    expect(picker.queryByText('Beef stew')).toBeNull()
    expect(count(/^Beef\d+$/)).toBe(1) // with Pasta on, Beef counts beef pastas
    expect(count(/^Chicken\d+$/)).toBe(0)
    fireEvent.click(picker.getByRole('button', { name: /^Pasta\d+$/ }))

    fireEvent.click(picker.getByRole('button', { name: /^Liked\d+$/ }))
    expect(picker.getByText('Chicken and rice')).toBeTruthy()
    expect(picker.queryByText('Beef stew')).toBeNull()
  })

  it('sorts the picker by most protein, and puts recipes you disliked last', async () => {
    const { chicken, beef, salmon } = await threeRecipes()
    await db.recipes.update(beef, { rating: 'dislike' })
    open('/plan')
    await addMeal(0, 'dinner')
    const picker = lastDialog()
    const titles = () => [...document.querySelectorAll('.picker-list .r-name')].map((e) => e.textContent?.trim())
    expect(titles()).toEqual(['Chicken and rice', 'Salmon and potatoes', 'Beef stew']) // A to Z, the disliked one last
    fireEvent.click(picker.getByRole('button', { name: 'Most protein' }))
    const byProtein = titles()
    expect(byProtein.at(-1)).toBe('Beef stew') // still last
    expect(new Set(byProtein)).toEqual(new Set(['Chicken and rice', 'Salmon and potatoes', 'Beef stew']))
    void chicken
    void salmon
  })

  it('shows the pantry suggestions only while nothing is searched or filtered', async () => {
    await threeRecipes()
    await stock('Chicken breast', 500, addDays(TODAY, 2))
    await stock('White rice', 500, addDays(TODAY, 90))
    await stock('Broccoli', 300, addDays(TODAY, 20))
    open('/plan')
    await addMeal(0, 'dinner')
    const picker = lastDialog()
    expect(await picker.findByText('From your pantry')).toBeTruthy()
    fireEvent.click(picker.getByRole('button', { name: /^Beef\d+$/ })) // any filter hides them, not just a search
    await waitFor(() => expect(picker.queryByText('From your pantry')).toBeNull())
    fireEvent.click(picker.getByRole('button', { name: /^Beef\d+$/ }))
    expect(await picker.findByText('From your pantry')).toBeTruthy()
  })

  it('shows each recipe\'s description in the picker so you know what it is', async () => {
    await db.recipes.add({
      title: 'Boxty', description: 'Irish potato pancakes, fried until golden.', servings: 4, servingsPerMeal: 1,
      ingredients: [await line('Potato', 600), await line('Eggs', 2, 'piece')], steps: ['Cook it.'], estMinutes: 30, actualMinutesHistory: [],
    })
    open('/plan')
    await addMeal(0, 'dinner')
    expect(lastDialog().getByText('Irish potato pancakes, fried until golden.')).toBeTruthy()
  })

  it('suggests meals your pantry can make, food about to expire first, before you search', async () => {
    await threeRecipes()
    const soon = addDays(TODAY, 2)
    await stock('Chicken breast', 500, soon)
    await stock('White rice', 500, addDays(TODAY, 90))
    await stock('Broccoli', 300, addDays(TODAY, 5))
    open('/plan')
    await addMeal(0, 'dinner')
    const picker = lastDialog()
    expect(await picker.findByText('From your pantry')).toBeTruthy()
    expect(picker.getByText('You have everything')).toBeTruthy()
    expect(picker.getByText('Uses up chicken breast')).toBeTruthy()
    // searching puts the plain list back
    fireEvent.change(picker.getByRole('searchbox', { name: 'Search recipes' }), { target: { value: 'beef' } })
    await waitFor(() => expect(picker.queryByText('From your pantry')).toBeNull())
  })

  it('offers no pantry suggestions when the pantry is empty', async () => {
    await threeRecipes()
    open('/plan')
    await addMeal(0, 'dinner')
    expect(lastDialog().getByText('Beef stew')).toBeTruthy()
    expect(lastDialog().queryByText('From your pantry')).toBeNull()
  })

  it('plans some plain foods instead of a recipe, and changes them by tapping the meal', async () => {
    await threeRecipes()
    open('/plan')
    await addMeal(0, 'dinner')
    fireEvent.click(lastDialog().getByRole('button', { name: 'Just some foods, no recipe' }))
    const foods = lastDialog()
    fireEvent.change(foods.getByLabelText(/What did you have/), { target: { value: 'banana' } })
    fireEvent.click(await foods.findByRole('button', { name: 'Banana' }))
    expect(foods.queryByRole('checkbox', { name: /eaten it/ })).toBeNull() // planning ahead: not eaten yet
    fireEvent.click(foods.getByRole('button', { name: 'Save meal' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await (await col(0)).findByText('Banana')).toBeTruthy()
    const entry = (await db.mealPlan.toArray())[0]
    expect(entry.recipeId).toBeUndefined()
    expect(entry.foods).toHaveLength(1)
    // tapping it opens its foods, to change them
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Dinner, .*: Banana, \d+ kcal/ }))
    const edit = lastDialog()
    fireEvent.change(edit.getByLabelText('Amount of Banana'), { target: { value: '2' } })
    fireEvent.click(edit.getByRole('button', { name: 'Save changes' }))
    await waitFor(async () => expect((await db.mealPlan.get(entry.id!))!.foods![0].qty).toBe(2))
  })

  it('lets you say you are borrowing a food for a meal, so it is not on your shopping list', async () => {
    const { chicken } = await threeRecipes()
    const id = (await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })) as number
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Dinner, .*Chicken and rice/ }))
    const sheet = sheetFor('Dinner')
    const broccoli = sheet.getByRole('checkbox', { name: 'Borrowing Broccoli' }) as HTMLInputElement
    expect(broccoli.checked).toBe(false)
    fireEvent.click(broccoli)
    const food = (await db.ingredients.where('name').equals('Broccoli').first())!
    await waitFor(async () => expect((await db.mealPlan.get(id))?.borrowed).toEqual([food.id]))
    await waitFor(() => expect((sheet.getByRole('checkbox', { name: 'Borrowing Broccoli' }) as HTMLInputElement).checked).toBe(true))
    fireEvent.click(sheet.getByRole('checkbox', { name: 'Borrowing Broccoli' }))
    await waitFor(async () => expect((await db.mealPlan.get(id))?.borrowed).toBeUndefined())
  })

  it('plans a single day from the button beside its date, leaving the other days alone', async () => {
    await threeRecipes()
    await fillerRecipes()
    open('/plan')
    const tomorrow = addDays(TODAY, 1)
    const label = `Plan ${new Date(`${tomorrow}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${new Date(`${tomorrow}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
    fireEvent.click(await screen.findByRole('button', { name: label }))
    await screen.findByText(/^Planned 2 meals for /, {}, { timeout: 5000 })
    const meals = await db.mealPlan.toArray()
    expect(meals.map((m) => [m.date, m.slot]).sort()).toEqual([
      [tomorrow, 'dinner'],
      [tomorrow, 'lunch'],
    ])
    // the day is full now: planning it again adds nothing
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(await screen.findByText('Nothing to add: every meal in this day is already planned.', {}, { timeout: 5000 })).toBeTruthy()
  })

  it('offers no plan button on a day that has gone', async () => {
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: 'Previous day' }))
    const yesterday = addDays(TODAY, -1)
    const col = await waitFor(() => document.querySelector(`[data-date="${yesterday}"]`) as HTMLElement)
    expect(within(col).queryByRole('button', { name: /^Plan / })).toBeNull()
    expect(within(document.querySelector(`[data-date="${TODAY}"]`) as HTMLElement).getByRole('button', { name: /^Plan / })).toBeTruthy()
  })

  it('changes the servings in half steps, never below half a serving', async () => {
    const { chicken } = await threeRecipes()
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Dinner, .*Chicken and rice/ }))
    const sheet = sheetFor('Dinner')
    fireEvent.click(sheet.getByRole('button', { name: 'More servings of Chicken and rice' }))
    expect(await sheet.findByText('1.5 servings')).toBeTruthy()
    fireEvent.click(sheet.getByRole('button', { name: 'Fewer servings of Chicken and rice' }))
    fireEvent.click(sheet.getByRole('button', { name: 'Fewer servings of Chicken and rice' }))
    expect(await sheet.findByText('0.5 servings')).toBeTruthy()
    expect((sheet.getByRole('button', { name: 'Fewer servings of Chicken and rice' }) as HTMLButtonElement).disabled).toBe(true)
    expect((await db.mealPlan.toArray())[0].servingsPlanned).toBe(0.5)
  })

  it('remembers the portion you usually eat, and plans it next time', async () => {
    const { chicken } = await threeRecipes()
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Dinner, .*Chicken and rice/ }))
    const sheet = sheetFor('Dinner')
    expect(sheet.queryByRole('button', { name: /my usual portion/ })).toBeNull() // nothing to remember while it matches
    fireEvent.click(sheet.getByRole('button', { name: 'More servings of Chicken and rice' }))
    fireEvent.click(sheet.getByRole('button', { name: 'More servings of Chicken and rice' })) // 2 servings
    fireEvent.click(await sheet.findByRole('button', { name: 'Make 2 servings my usual portion of Chicken and rice' }))
    await waitFor(async () => expect((await db.recipes.get(chicken))!.servingsPerMeal).toBe(2))
    await waitFor(() => expect(sheet.queryByRole('button', { name: /my usual portion/ })).toBeNull())

    await db.mealPlan.clear()
    cleanup()
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    await screen.findByText(/Planned/)
    const planned = (await db.mealPlan.toArray()).filter((e) => e.recipeId === chicken)
    expect(planned.length).toBeGreaterThan(0)
    expect(planned.every((e) => e.servingsPlanned === 2)).toBe(true)
  })

  it('opens a planned meal with its recipe, servings and times, and no "What is this meal?" section', async () => {
    const { chicken } = await threeRecipes()
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Dinner, .*Chicken and rice/ }))
    const sheet = sheetFor('Dinner')
    expect(sheet.getByRole('group', { name: 'Servings of Chicken and rice' })).toBeTruthy()
    expect(sheet.getByRole('group', { name: 'Eat at' })).toBeTruthy()
    expect(sheet.getByRole('button', { name: 'Clear this meal' })).toBeTruthy()
    expect(sheet.queryByText('What is this meal?')).toBeNull()
    expect(sheet.queryByRole('button', { name: /Change the recipe|Choose a recipe/ })).toBeNull()
  })

  it('has a View recipe button that opens the recipe inside the app', async () => {
    const { chicken } = await threeRecipes()
    await db.recipes.update(chicken, { source: 'https://example.com/chicken' }) // an outside page exists, but the button stays in the app
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Dinner, .*Chicken and rice/ }))
    const view = sheetFor('Dinner').getByRole('link', { name: 'View recipe' })
    expect(view.getAttribute('href')).toBe(`/recipes/${chicken}`)
    expect(view.getAttribute('target')).toBeNull() // not a new tab
    fireEvent.click(view)
    expect(await screen.findByRole('heading', { name: 'Chicken and rice' })).toBeTruthy() // the recipe screen
    expect(screen.queryByRole('dialog')).toBeNull() // the sheet closed
  })

  it('goes back to the plan from a recipe opened from a meal, not to the list of recipes', async () => {
    const { chicken } = await threeRecipes()
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Dinner, .*Chicken and rice/ }))
    fireEvent.click(sheetFor('Dinner').getByRole('link', { name: 'View recipe' }))
    await screen.findByRole('heading', { name: 'Chicken and rice' })
    const back = backLink() // the back button says where it goes
    expect(back.textContent).toContain('Plan')
    expect(back.getAttribute('href')).toBe('/plan')
    fireEvent.click(back)
    expect(await screen.findByRole('heading', { name: 'Plan' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Chicken and rice' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Recipes' })).toBeNull() // it did not go via the list
  })

  it('the recipe title in the meal sheet goes back to the plan too', async () => {
    const { chicken } = await threeRecipes()
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Dinner, .*Chicken and rice/ }))
    fireEvent.click(sheetFor('Dinner').getByRole('link', { name: 'Chicken and rice' }))
    await screen.findByRole('heading', { name: 'Chicken and rice' })
    expect(backLink().textContent).toContain('Plan')
    fireEvent.click(backLink())
    expect(await screen.findByRole('heading', { name: 'Plan' })).toBeTruthy()
  })

  it('still goes back to the recipe list from a recipe opened there', async () => {
    const { chicken } = await threeRecipes()
    open('/recipes')
    fireEvent.click(await screen.findByRole('link', { name: /Chicken and rice/ }))
    await screen.findByRole('heading', { name: 'Chicken and rice' })
    const back = backLink()
    expect(back.textContent).toContain('Recipes')
    expect(back.getAttribute('href')).toBe('/recipes')
    fireEvent.click(back)
    expect(await screen.findByRole('heading', { name: 'Recipes' })).toBeTruthy()
    void chicken
  })

  it('changes a meal by clearing it and choosing again from the empty meal', async () => {
    const { chicken } = await threeRecipes()
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Dinner, .*Chicken and rice/ }))
    fireEvent.click(sheetFor('Dinner').getByRole('button', { name: 'Clear this meal' }))
    await waitFor(async () => expect(await db.mealPlan.count()).toBe(0))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await addMeal(0, 'dinner') // an empty meal opens the picker
    fireEvent.click(lastDialog().getByText('Beef stew'))
    await waitFor(async () => expect((await db.mealPlan.toArray())[0].recipeId).toBeDefined())
    expect((await db.recipes.get((await db.mealPlan.toArray())[0].recipeId!))!.title).toBe('Beef stew')
  })

  it('rates the recipe from the meal, and a disliked recipe is not planned for you', async () => {
    const { chicken } = await threeRecipes()
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Dinner, .*Chicken and rice/ }))
    fireEvent.click(sheetFor('Dinner').getByRole('button', { name: 'Dislike' }))
    await waitFor(async () => expect((await db.recipes.get(chicken))!.rating).toBe('dislike'))
    cleanup()
    await db.mealPlan.clear()
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    await screen.findByText(/Planned/)
    expect((await db.mealPlan.toArray()).some((e) => e.recipeId === chicken)).toBe(false)
  })

  it('"Plan these days" fills every empty meal for the 3 days shown, with no leftovers you did not ask for, and keeps what you already planned', async () => {
    const { salmon } = await threeRecipes()
    await fillerRecipes()
    await db.mealPlan.add({ date: addDays(TODAY, 2), slot: 'dinner', recipeId: salmon, servingsPlanned: 2, status: 'planned' })
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    expect(await screen.findByText(/Planned 5 meals/)).toBeTruthy() // 6 slots, one already filled
    expect(await db.mealPlan.count()).toBe(6)
    const mine = (await db.mealPlan.toArray()).find((e) => e.date === addDays(TODAY, 2) && e.slot === 'dinner')!
    expect(mine).toMatchObject({ recipeId: salmon, servingsPlanned: 2 }) // untouched
    // none of the meals is leftovers, since you tagged none: no tag, and no recipe repeated within the leftover days
    expect(screen.queryByText('Leftovers', { selector: '.cell-chip' })).toBeNull()
    const ids = (await db.mealPlan.toArray()).map((e) => e.recipeId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('says so when there is nothing left to plan', async () => {
    await threeRecipes()
    await fillerRecipes()
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    await screen.findByText(/Planned 6 meals/)
    fireEvent.click(screen.getByRole('button', { name: /Plan these days/ }))
    expect(await screen.findByText(/Nothing to add: every meal in these 3 days is already planned/)).toBeTruthy()
  })

  it('never plans a recipe you should avoid', async () => {
    await db.tagSensitivities.put({ tag: 'fish', sensitivity: 'major' })
    const { salmon } = await threeRecipes()
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    await screen.findByText(/Planned/)
    expect((await db.mealPlan.toArray()).some((e) => e.recipeId === salmon)).toBe(false)
  })

  it('tells you when there are no recipes to plan with', async () => {
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    expect(await screen.findByText(/no recipes you can cook yet/)).toBeTruthy()
  })

  it('clears the three days you are looking at, meals and grocery trips, after asking, with no "cleared" note', async () => {
    await threeRecipes()
    await fillerRecipes()
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    await screen.findByText(/Planned 6 meals/)
    await db.trips.bulkAdd([
      { date: TODAY, after: 'start', time: '11:00' },
      { date: addDays(TODAY, 1), after: 'lunch', time: '15:30' },
      { date: addDays(TODAY, 5), after: 'start', time: '10:00' }, // not one of the three days on screen
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Clear these days' }))
    expect(await db.mealPlan.count()).toBe(6) // not yet
    expect(await db.trips.count()).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: 'Yes, clear these days' }))
    await waitFor(async () => expect(await db.mealPlan.count()).toBe(0))
    expect(await db.trips.toArray()).toEqual([expect.objectContaining({ date: addDays(TODAY, 5) })]) // only the three days' trips went
    expect(screen.queryByText(/Cleared/)).toBeNull() // no note
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear these days' })).toBeNull())
  })

  it('offers to clear the days even when they only have a grocery trip', async () => {
    await db.trips.add({ date: TODAY, after: 'start', time: '11:00' })
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: 'Clear these days' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, clear these days' }))
    await waitFor(async () => expect(await db.trips.count()).toBe(0))
  })

  it('clears a single day, meals and grocery trips, after asking, and leaves the other days', async () => {
    const { chicken, beef } = await threeRecipes()
    await db.mealPlan.bulkAdd([
      { date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' },
      { date: addDays(TODAY, 1), slot: 'dinner', recipeId: beef, servingsPlanned: 1, status: 'planned' },
    ])
    await db.trips.bulkAdd([
      { date: TODAY, after: 'start', time: '11:00' },
      { date: addDays(TODAY, 1), after: 'start', time: '11:00' },
    ])
    open('/plan')
    const first = await col(0)
    fireEvent.click(await first.findByRole('button', { name: /^Clear \w+ \d+ \w+$/ }))
    // it asks first: nothing is gone yet
    expect(await db.mealPlan.count()).toBe(2)
    // the confirm is the same button, in the same place: the bin turns into "Yes, clear"
    const corner = first.getByRole('button', { name: /^Yes, clear \w+ \d+ \w+$/ })
    expect(corner.classList.contains('col-clear')).toBe(true)
    expect(first.queryByRole('button', { name: /^Clear \w+ \d+ \w+$/ })).toBeNull()
    expect(first.queryByText(/Clear this day\?/)).toBeNull() // no separate box
    // clicking away cancels it
    fireEvent.blur(corner)
    expect(first.queryByRole('button', { name: /^Yes, clear/ })).toBeNull()
    expect(await db.mealPlan.count()).toBe(2)

    fireEvent.click(first.getByRole('button', { name: /^Clear \w+ \d+ \w+$/ }))
    fireEvent.click(first.getByRole('button', { name: /^Yes, clear \w+ \d+ \w+$/ }))
    await waitFor(async () => expect(await db.mealPlan.count()).toBe(1))
    expect((await db.mealPlan.toArray())[0].date).toBe(addDays(TODAY, 1)) // tomorrow's meal stays
    expect((await db.trips.toArray()).map((x) => x.date)).toEqual([addDays(TODAY, 1)]) // and tomorrow's trip
    expect(screen.queryByText(/Cleared/)).toBeNull()
    // today has nothing to clear now, so no bin on it; tomorrow still has one
    await waitFor(() => expect(first.queryByRole('button', { name: /^Clear \w+ \d+ \w+$/ })).toBeNull())
    expect((await col(1)).getByRole('button', { name: /^Clear \w+ \d+ \w+$/ })).toBeTruthy()
  })

  it('cancels the clear-day question with Escape, and clears nothing', async () => {
    const { chicken } = await threeRecipes()
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    const first = await col(0)
    fireEvent.click(await first.findByRole('button', { name: /^Clear \w+ \d+ \w+$/ }))
    fireEvent.keyDown(first.getByRole('button', { name: /^Yes, clear/ }), { key: 'Escape' })
    expect(first.getByRole('button', { name: /^Clear \w+ \d+ \w+$/ })).toBeTruthy()
    expect(await db.mealPlan.count()).toBe(1)
  })

  it('shows no clear button on a day with nothing planned', async () => {
    open('/plan')
    await col(0)
    expect(screen.queryByRole('button', { name: /^Clear \w+ \d+ \w+$/ })).toBeNull()
  })

  it('slides one day at a time, and back to today, with no date range between the arrows', async () => {
    const { chicken } = await threeRecipes()
    await db.mealPlan.add({ date: addDays(TODAY, 1), slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    await screen.findByRole('heading', { name: 'Plan' })
    expect(document.querySelector('.week-label')).toBeNull()
    // "Clear these days" only shows while one of the three days on screen has a planned meal: tomorrow does
    expect(await screen.findByRole('button', { name: 'Clear these days' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Back to today' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next day' })) // now the day after tomorrow and the two after
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear these days' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(await screen.findByRole('button', { name: 'Clear these days' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next day' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back to today' }))
    expect(await screen.findByRole('button', { name: 'Clear these days' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Back to today' })).toBeNull()
  })

  it('shows a breakfast slot too when you plan breakfast', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, planSlots: ['breakfast', 'lunch', 'dinner'] })
    open('/plan')
    expect(await (await col(0)).findByRole('button', { name: /^Add breakfast/ })).toBeTruthy()
    expect((await col(0)).getByRole('button', { name: /^Add groceries .* between breakfast and lunch$/ })).toBeTruthy()
  })
})

describe('meals that are not a single recipe', () => {
  it('"Eating out" plans no food, and shows on the plan', async () => {
    await threeRecipes()
    open('/plan')
    fireEvent.click(await (await col(1)).findByRole('button', { name: /^Dinner, .*: eating out$/ })) // the quick button on the empty meal
    await waitFor(async () => expect((await db.mealPlan.toArray())[0]).toMatchObject({ constraint: 'out', status: 'planned' }))
    expect((await db.mealPlan.toArray())[0].recipeId).toBeUndefined()
    expect(screen.queryByRole('dialog')).toBeNull() // nothing opened
    expect(await (await col(1)).findByRole('button', { name: /^Dinner, .*: eating out$/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Plan these days/ }))
    await screen.findByText(/Planned/)
    expect((await db.mealPlan.toArray()).filter((e) => e.date === addDays(TODAY, 1) && e.slot === 'dinner')).toHaveLength(1) // still just the one, still out
  })

  it('marks a meal as leftovers, which stays "not planned yet" until you plan the week', async () => {
    await threeRecipes()
    open('/plan')
    fireEvent.click(await (await col(1)).findByRole('button', { name: /^Lunch, .*: leftovers$/ }))
    const cell = await (await col(1)).findByRole('button', { name: /^Lunch, .*leftovers, not planned yet$/ })
    expect(within(cell).getByText('Not planned yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Plan these days/ }))
    await waitFor(async () => expect((await db.mealPlan.toArray()).find((e) => e.slot === 'lunch' && e.date === addDays(TODAY, 1))?.recipeId).toBeDefined())
    // it is the night before's dinner, and it keeps its Leftovers label
    const lunch = (await db.mealPlan.toArray()).find((e) => e.slot === 'lunch' && e.date === addDays(TODAY, 1))!
    const dinner = (await db.mealPlan.toArray()).find((e) => e.slot === 'dinner' && e.date === TODAY)!
    expect(lunch.recipeId).toBe(dinner.recipeId)
    expect(lunch.constraint).toBe('leftovers')
  })

  it('explains a meal it could not plan, in words you can act on', async () => {
    await addRecipe('Slow stew', [line('Beef chuck roast', 500), line('Potato', 400)])
    await db.recipes.where('title').equals('Slow stew').modify({ estMinutes: 180 })
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', constraint: 'quick', servingsPlanned: 1, status: 'planned' })
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    expect(await screen.findByText(/Could not plan this meal|Could not plan these meals/)).toBeTruthy()
    expect(screen.getByText(/dinner: No recipe takes 30 minutes or less\./)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(screen.queryByText(/No recipe takes 30 minutes/)).toBeNull())
  })
})

describe('meal times', () => {
  it('shows your usual time, works out when to start cooking, and lets you change either', async () => {
    const { chicken } = await threeRecipes()
    await db.recipes.update(chicken, { estMinutes: 45 })
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/plan')
    const cell = await (await col(0)).findByRole('button', { name: /^Dinner, .*Chicken and rice/ })
    expect(within(cell).getByText('6:30 PM')).toBeTruthy() // shown in 12-hour time
    fireEvent.click(cell)
    const sheet = sheetFor('Dinner')
    expect(timeValue(sheet, 'Eat at')).toBe('18:30')
    expect(sheet.queryByRole('group', { name: 'Start cooking at' })).toBeNull() // no cooking time any more

    setTime(sheet, 'Eat at', '20:00')
    await waitFor(async () => expect((await db.mealPlan.toArray())[0].eatAt).toBe('20:00'))

    fireEvent.click(sheet.getByRole('button', { name: 'Use the usual time' }))
    await waitFor(async () => expect((await db.mealPlan.toArray())[0].eatAt).toBeUndefined())
  })

  it('shows times as 18:30 when the setting is 24-hour', async () => {
    const { chicken } = await threeRecipes()
    await db.settings.put({ ...DEFAULT_SETTINGS, timeFormat: '24h' })
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    await db.trips.add({ date: TODAY, after: 'lunch', time: '15:30' })
    open('/plan')
    const first = await col(0)
    const cell = await first.findByRole('button', { name: /^Dinner, .*Chicken and rice/ })
    expect(within(cell).getByText('18:30')).toBeTruthy()
    expect(await first.findByRole('button', { name: /between lunch and dinner, at 15:30\. Change$/ })).toBeTruthy()
    fireEvent.click(cell)
    expect(within(sheetFor('Dinner').getByRole('group', { name: 'Eat at' })).getAllByRole('combobox')).toHaveLength(2) // hour and minute
  })

  it('has an x on a planned meal that takes it off the plan, without opening anything', async () => {
    const { chicken, beef } = await threeRecipes()
    await db.mealPlan.bulkAdd([
      { date: TODAY, slot: 'lunch', recipeId: beef, servingsPlanned: 1, status: 'planned' },
      { date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' },
    ])
    open('/plan')
    const first = await col(0)
    fireEvent.click(await first.findByRole('button', { name: /^Remove dinner, .*: Chicken and rice$/ }))
    await waitFor(async () => expect(await db.mealPlan.count()).toBe(1))
    expect((await db.mealPlan.toArray())[0].slot).toBe('lunch') // only that meal went
    expect(screen.queryByRole('dialog')).toBeNull() // nothing opened
    // the empty meal is back, with its quick buttons
    expect(await first.findByRole('button', { name: /^Add dinner/ })).toBeTruthy()
    expect(first.getByRole('button', { name: /^Dinner, .*: leftovers$/ })).toBeTruthy()
    // the other meal is untouched
    expect(first.getByRole('button', { name: /^Remove lunch, .*: Beef stew$/ })).toBeTruthy()
  })

  it('has no x on an empty meal, and a meal marked eating out has its tag x instead', async () => {
    await db.mealPlan.add({ date: TODAY, slot: 'lunch', servingsPlanned: 1, status: 'planned', constraint: 'out' })
    open('/plan')
    const first = await col(0)
    expect(await first.findByRole('button', { name: /^Clear Lunch, .*: eating out$/ })).toBeTruthy()
    expect(first.queryByRole('button', { name: /^Remove lunch/ })).toBeNull() // one x per meal, not two
    expect(first.queryByRole('button', { name: /^Remove dinner/ })).toBeNull() // dinner is empty: nothing to remove
  })

  it('puts a snack where its time falls in the day, not always after dinner', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, planSlots: ['lunch', 'dinner', 'snack'] })
    open('/plan')
    const first = await col(0)
    const order = () => [...dayCol(0)!.querySelectorAll('.cell-slot')].map((e) => e.textContent)
    await waitFor(() => expect(order()).toEqual(['Lunch', 'Snack', 'Dinner'])) // the snack is at 3:30 PM
    // the grocery places follow: between lunch and the snack, then between the snack and dinner
    expect(first.getByRole('button', { name: /Add groceries .* between lunch and a snack$/ })).toBeTruthy()
    expect(first.getByRole('button', { name: /Add groceries .* between a snack and dinner$/ })).toBeTruthy()

    // a snack set for 9 PM goes last
    await db.settings.put({ ...DEFAULT_SETTINGS, planSlots: ['lunch', 'dinner', 'snack'], mealTimes: { ...DEFAULT_SETTINGS.mealTimes!, snack: '21:00' } })
    await waitFor(() => expect(order()).toEqual(['Lunch', 'Dinner', 'Snack']))
  })

  it('orders one day by the time you set on its snack', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, planSlots: ['lunch', 'dinner', 'snack'] })
    await db.mealPlan.add({ date: TODAY, slot: 'snack', servingsPlanned: 1, status: 'planned', constraint: 'any', eatAt: '19:30' })
    open('/plan')
    await col(0)
    const order = (i: number) => [...dayCol(i)!.querySelectorAll('.cell-slot')].map((e) => e.textContent)
    await waitFor(() => expect(order(0)).toEqual(['Lunch', 'Dinner', 'Snack'])) // 7:30 PM, after dinner, on that day only
    expect(order(1)).toEqual(['Lunch', 'Snack', 'Dinner']) // the next day keeps your usual time
  })

  it('leftovers need no cooking time', async () => {
    const { chicken } = await threeRecipes()
    await db.mealPlan.bulkAdd([
      { date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' },
      { date: addDays(TODAY, 1), slot: 'lunch', recipeId: chicken, servingsPlanned: 1, status: 'planned' },
    ])
    open('/plan')
    fireEvent.click(await (await col(1)).findByRole('button', { name: /^Lunch, .*Chicken and rice/ }))
    const sheet = sheetFor('Lunch')
    expect(sheet.queryByRole('group', { name: 'Borrowing any of this?' })).toBeNull() // nothing is cooked for leftovers
  })
})

describe('grocery trips on the plan', () => {
  it('adds a trip at a sensible time in one tap, opens it to change the details, and removes it', async () => {
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Add groceries .* before lunch$/ }))
    // saved at once, 90 minutes before lunch at 12:30, with nothing opening
    await waitFor(async () => expect(await db.trips.toArray()).toEqual([expect.objectContaining({ date: TODAY, after: 'start', time: '11:00' })]))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Groceries .* before lunch, at 11:00 AM\. Change$/ }))
    const dialog = within(screen.getByRole('dialog'))
    expect(timeValue(dialog, 'Go at')).toBe('11:00')
    fireEvent.change(dialog.getByLabelText('Note (optional)'), { target: { value: 'big shop' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save trip' }))
    await waitFor(async () => expect(await db.trips.toArray()).toEqual([expect.objectContaining({ time: '11:00', note: 'big shop' })]))
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Groceries .* before lunch, at 11:00 AM\. Change$/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove this trip' }))
    await waitFor(async () => expect(await db.trips.count()).toBe(0))
  })

  it('puts the middle and last trips of the day at sensible times', async () => {
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /Add groceries .* between lunch and dinner$/ }))
    fireEvent.click((await col(0)).getByRole('button', { name: /Add groceries .* after dinner$/ }))
    await waitFor(async () => expect((await db.trips.toArray()).map((x) => [x.after, x.time]).sort()).toEqual([['dinner', '20:00'], ['lunch', '15:30']]))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('changing a trip\'s time keeps it in the same place', async () => {
    await db.trips.add({ date: TODAY, after: 'lunch', time: '15:30' })
    open('/plan')
    fireEvent.click(await (await col(0)).findByRole('button', { name: /^Groceries .* between lunch and dinner, at 3:30 PM/ }))
    setTime(within(screen.getByRole('dialog')), 'Go at', '16:15')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save trip' }))
    await waitFor(async () => expect((await db.trips.toArray())).toEqual([expect.objectContaining({ after: 'lunch', time: '16:15' })]))
  })

  it('plans around your trips: with no groceries in, only meals your pantry covers come before the first trip', async () => {
    await threeRecipes()
    const longLife = addDays(TODAY, 30)
    await stock('Chicken breast', 400, longLife)
    await stock('White rice', 200, longLife)
    await stock('Broccoli', 200, longLife)
    await db.settings.put({ ...DEFAULT_SETTINGS, planSlots: ['dinner'] })
    await db.trips.add({ date: addDays(TODAY, 2), after: 'start', time: '10:00' })
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    await screen.findByText(/Planned/)
    const meals = await db.mealPlan.toArray()
    const chicken = (await db.recipes.where('title').equals('Chicken and rice').first())!.id!
    // before the trip (the first two days) only the chicken dish is covered by the pantry
    expect(meals.filter((e) => e.date < addDays(TODAY, 2)).every((e) => e.recipeId === chicken)).toBe(true)
    expect(meals.filter((e) => e.date >= addDays(TODAY, 2)).length).toBeGreaterThan(0) // after the trip, anything goes
  })
})

describe('the week you described', () => {
  it('leftovers for Wednesday lunch, out Friday dinner, little time Monday, groceries Monday and Thursday', async () => {
    const { chicken } = await threeRecipes()
    await fillerRecipes()
    const quick = await addRecipe('Egg toast', [line('Eggs', 200), line('White bread', 100)])
    await db.recipes.update(quick, { estMinutes: 10 })
    const [d0, d1, d2, d3, d4, d5, d6] = weekDays(TODAY, 7) // d0 is today, a Thursday in the examples
    await db.mealPlan.bulkAdd([
      { date: d5, slot: 'lunch', constraint: 'leftovers', servingsPlanned: 1, status: 'planned' }, // "Wednesday" lunch
      { date: d1, slot: 'dinner', constraint: 'out', servingsPlanned: 1, status: 'planned' }, // "Friday" dinner
      { date: d4, slot: 'lunch', constraint: 'quick', servingsPlanned: 1, status: 'planned' }, // "Monday"
      { date: d4, slot: 'dinner', constraint: 'quick', servingsPlanned: 1, status: 'planned' },
    ])
    await db.trips.bulkAdd([
      { date: d4, after: 'start', time: '09:00' }, // Monday
      { date: d0, after: 'start', time: '09:00' }, // Thursday
    ])
    await stock('Chicken breast', 400, addDays(TODAY, 30)) // the cupboard has something to cook before the first trip
    await stock('White rice', 200, addDays(TODAY, 30))
    await stock('Broccoli', 200, addDays(TODAY, 30))
    void chicken
    void d2
    void d3
    void d6
    open('/plan')
    for (let i = 0; i < 3; i++) fireEvent.click(await screen.findByRole('button', { name: 'Next day' })) // the plan fills the three days on screen
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    await screen.findByText(/Planned/, {}, { timeout: 5000 }) // planning a week with all these rules takes a moment

    const meals = await db.mealPlan.toArray()
    const at = (date: string, slot: string) => meals.find((e) => e.date === date && e.slot === slot)
    const minutes = async (id?: number) => (id == null ? undefined : (await db.recipes.get(id))!.estMinutes)
    expect(at(d1, 'dinner')).toMatchObject({ constraint: 'out' })
    expect(at(d1, 'dinner')!.recipeId).toBeUndefined() // out stays out
    expect(await minutes(at(d4, 'lunch')?.recipeId)).toBeLessThanOrEqual(30)
    expect(await minutes(at(d4, 'dinner')?.recipeId)).toBeLessThanOrEqual(30)
    expect(at(d5, 'lunch')!.recipeId).toBeDefined()
    expect(at(d5, 'lunch')!.recipeId).toBe(at(addDays(d5, -1), 'dinner')!.recipeId) // Wednesday lunch is Tuesday's dinner
    expect(at(d5, 'lunch')!.constraint).toBe('leftovers')
  })
})

describe('the Shopping screen', () => {
  const planAWeek = async () => {
    await threeRecipes()
    await fillerRecipes()
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    await screen.findByText(/Planned 6 meals/)
    cleanup()
  }

  it('says there is nothing to buy until you plan meals', async () => {
    open('/shopping')
    expect(await screen.findByText(/Nothing to buy yet/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Plan some meals' })).toBeTruthy()
  })

  it('lists what the plan needs, by aisle, with how much to buy and by when', async () => {
    await planAWeek()
    open('/shopping')
    expect(await screen.findByText(/items? to buy for 6 planned meals/)).toBeTruthy()
    expect(screen.getAllByRole('heading', { level: 2 }).some((h) => /Meat/.test(h.textContent ?? ''))).toBe(true)
    const rows = document.querySelectorAll('.shop-row')
    expect(rows.length).toBeGreaterThan(4)
    expect(document.querySelector('.shop-buy')!.textContent).toMatch(/\d/)
    // every ingredient says how soon it is needed, in one badge
    const badges = [...document.querySelectorAll('.shop-when')].map((b) => b.textContent ?? '')
    expect(badges).toHaveLength(rows.length)
    for (const text of badges) expect(text).toMatch(/^(Today|Tomorrow|In \d+ days|By .+)$/)
    expect(document.body.textContent).not.toMatch(/Needed .* for /) // and not what it is for
  })

  it('says when something is needed in days, and as a date only when it is more than 5 days away', async () => {
    const { chicken, beef, salmon } = await threeRecipes()
    const pork = await addRecipe('Pork chops', [line('Pork chop', 400)])
    await db.mealPlan.bulkAdd([
      { date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' },
      { date: addDays(TODAY, 1), slot: 'dinner', recipeId: beef, servingsPlanned: 1, status: 'planned' },
      { date: addDays(TODAY, 5), slot: 'dinner', recipeId: salmon, servingsPlanned: 1, status: 'planned' },
      { date: addDays(TODAY, 6), slot: 'dinner', recipeId: pork, servingsPlanned: 1, status: 'planned' },
    ])
    open('/shopping')
    const rowFor = async (food: string) => (await screen.findByText(food)).closest('.shop-row') as HTMLElement
    const { formatDate } = await import('./lib/pantry')
    const when = async (food: string) => (await rowFor(food)).querySelector('.shop-when')!.textContent
    expect(await when('Chicken breast')).toBe('Today')
    expect(await when('Beef chuck roast')).toBe('Tomorrow')
    expect(await when('Salmon')).toBe('In 5 days') // 5 days is still a number of days
    expect(await when('Pork chop')).toBe(`By ${formatDate(addDays(TODAY, 6))}`) // 6 days: a date
    // the row is just the ingredient, its amount and when: no recipe names
    for (const food of ['Chicken breast', 'Beef chuck roast', 'Salmon', 'Pork chop']) {
      const text = (await rowFor(food)).textContent!
      expect(text).not.toMatch(/Chicken and rice|Beef stew|Salmon and potatoes|Pork chops|Needed/)
    }
  })

  it('highlights what is needed today or tomorrow', async () => {
    const { chicken, beef, salmon } = await threeRecipes()
    await db.mealPlan.bulkAdd([
      { date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' },
      { date: addDays(TODAY, 1), slot: 'dinner', recipeId: beef, servingsPlanned: 1, status: 'planned' },
      { date: addDays(TODAY, 3), slot: 'dinner', recipeId: salmon, servingsPlanned: 1, status: 'planned' },
    ])
    open('/shopping')
    const rowFor = async (food: string) => (await screen.findByText(food)).closest('.shop-row') as HTMLElement
    expect((await rowFor('Chicken breast')).className).toContain('urgent') // today
    expect((await rowFor('Beef chuck roast')).className).toContain('urgent') // tomorrow
    expect((await rowFor('Salmon')).className).not.toContain('urgent') // in 3 days
  })

  it('has a bold header for each aisle that folds the group away and back', async () => {
    await planAWeek()
    open('/shopping')
    const header = await screen.findByRole('button', { name: /^Meat/ })
    expect(header.getAttribute('aria-expanded')).toBe('true')
    const body = document.getElementById(header.getAttribute('aria-controls')!)!
    expect(body.hidden).toBe(false)
    expect(body.querySelectorAll('.shop-row').length).toBeGreaterThan(0)
    // another aisle is not affected
    const other = screen.getAllByRole('button').find((b) => b.classList.contains('shop-head') && b !== header)!
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(body.hidden).toBe(true)
    expect(other.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(body.hidden).toBe(false)
  })

  it('counts what your pantry already has, and ignores food that has gone off', async () => {
    await threeRecipes()
    const { chicken } = { chicken: (await db.recipes.where('title').equals('Chicken and rice').first())!.id! }
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 4, status: 'planned' }) // the whole batch: 400 g chicken
    await stock('Chicken breast', 150, addDays(TODAY, 5))
    await stock('White rice', 1000, addDays(TODAY, -1)) // went off yesterday
    open('/shopping')
    const chickenRow = (await screen.findByText('Chicken breast')).closest('.shop-row') as HTMLElement
    expect(within(chickenRow).getByText(/You have 150 g/)).toBeTruthy()
    expect(within(chickenRow).getByText('250 g')).toBeTruthy() // 400 - 150
    const riceRow = screen.getByText('White rice').closest('.shop-row') as HTMLElement
    expect(within(riceRow).getByText('200 g')).toBeTruthy() // the expired rice does not count
  })

  it('ticking "Bought" puts it in your pantry and takes it off the list', async () => {
    await threeRecipes()
    const chicken = (await db.recipes.where('title').equals('Chicken and rice').first())!.id!
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 4, status: 'planned' })
    open('/shopping')
    fireEvent.click(await screen.findByRole('button', { name: 'Bought Chicken breast' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Bought Chicken breast' })).toBeNull())
    const item = (await db.pantryItems.toArray())[0]
    expect(item).toMatchObject({ qty: 400, unit: 'g', purchasedOn: TODAY, location: 'fridge' })
    expect(item.expiresOn).toBe(addDays(TODAY, 3))
    // it now shows as covered rather than missing
    fireEvent.click(await screen.findByText(/Already covered by your pantry/))
    expect(within(screen.getByText('Chicken breast').closest('.shop-row') as HTMLElement).getByText(/You have 400 g/)).toBeTruthy()
  })

  it('"I bought everything" clears the list', async () => {
    await planAWeek()
    open('/shopping')
    fireEvent.click(await screen.findByRole('button', { name: /I bought everything/ }))
    expect(await screen.findByText('You have everything for the meals you have planned.')).toBeTruthy()
    expect(await db.pantryItems.count()).toBeGreaterThan(4)
  })

  it('lists seasonings to check in the cupboard instead of buying them by weight', async () => {
    await threeRecipes()
    const beef = (await db.recipes.where('title').equals('Beef stew').first())!.id!
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: beef, servingsPlanned: 4, status: 'planned' })
    open('/shopping')
    expect(await screen.findByText(/The plan uses cumin and salt/)).toBeTruthy()
    expect(screen.queryByText('Cumin')).toBeNull()
  })

  it('says at the top how many ingredients are needed today and tomorrow, and nothing else', async () => {
    const { chicken, beef } = await threeRecipes()
    await db.mealPlan.bulkAdd([
      { date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' }, // chicken, rice, broccoli
      { date: addDays(TODAY, 1), slot: 'dinner', recipeId: beef, servingsPlanned: 1, status: 'planned' }, // beef, potato, carrot
    ])
    open('/shopping')
    const bar = await screen.findByRole('status')
    expect(bar.className).toContain('shop-due')
    const lines = [...bar.querySelectorAll('p')].map((x) => x.textContent)
    expect(lines).toEqual(['3 ingredients needed today', '3 ingredients needed tomorrow'])
    // none of the older wording about shopping days or trips
    expect(document.body.textContent).not.toMatch(/Shop sooner|next shopping day|Set your shopping days|before your first grocery trip/)
  })

  it('says "1 ingredient" for one, and leaves out a day with nothing needed', async () => {
    const salmon = await addRecipe('Plain salmon', [line('Salmon', 400)])
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', recipeId: salmon, servingsPlanned: 1, status: 'planned' })
    open('/shopping')
    const bar = await screen.findByRole('status')
    expect([...bar.querySelectorAll('p')].map((x) => x.textContent)).toEqual(['1 ingredient needed today']) // no line for tomorrow
  })

  it('shows nothing at the top when nothing is needed today or tomorrow', async () => {
    await threeRecipes()
    const chicken = (await db.recipes.where('title').equals('Chicken and rice').first())!.id!
    await db.mealPlan.add({ date: addDays(TODAY, 5), slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/shopping')
    expect(await screen.findByText('Chicken breast')).toBeTruthy()
    expect(document.querySelector('.shop-due')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows today as a dark badge and tomorrow as an amber one, with later days quiet', async () => {
    const { chicken, beef, salmon } = await threeRecipes()
    await db.mealPlan.bulkAdd([
      { date: TODAY, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' },
      { date: addDays(TODAY, 1), slot: 'dinner', recipeId: beef, servingsPlanned: 1, status: 'planned' },
      { date: addDays(TODAY, 4), slot: 'dinner', recipeId: salmon, servingsPlanned: 1, status: 'planned' },
    ])
    open('/shopping')
    const rowFor = async (food: string) => (await screen.findByText(food)).closest('.shop-row') as HTMLElement
    expect((await rowFor('Chicken breast')).className).toMatch(/\btoday\b/)
    expect((await rowFor('Beef chuck roast')).className).toMatch(/\btomorrow\b/)
    expect((await rowFor('Salmon')).className).not.toMatch(/urgent|today|tomorrow/)
  })

  it('with grocery trips on the plan, sorts the list by trip and flags what is needed before the first one', async () => {
    const { chicken, beef } = await threeRecipes()
    await db.mealPlan.bulkAdd([
      { date: addDays(TODAY, 1), slot: 'dinner', recipeId: chicken, servingsPlanned: 4, status: 'planned' }, // needed tomorrow
      { date: addDays(TODAY, 5), slot: 'dinner', recipeId: beef, servingsPlanned: 4, status: 'planned' },
    ])
    await db.trips.bulkAdd([
      { date: addDays(TODAY, 2), after: 'start', time: '10:00', note: 'weekend shop' },
      { date: addDays(TODAY, 4), after: 'start', time: '17:30' },
    ])
    open('/shopping')
    const heading = async (text: RegExp) => (await screen.findByRole('heading', { name: text })).closest('.group') as HTMLElement
    // the chicken dish is needed tomorrow, before either trip
    const early = await heading(/No grocery trip in time/)
    expect(within(early).getByText('Chicken breast')).toBeTruthy()
    expect((await screen.findByRole('status')).textContent).toBe('3 ingredients needed tomorrow') // the top bar
    // the stew is needed on day 5: the last trip before that is the one on day 4, so the earlier trip has nothing
    const later = await heading(new RegExp(`5:30 PM`))
    expect(within(later).getByText('Beef chuck roast')).toBeTruthy()
    const first = await heading(new RegExp(`10:00 AM`))
    expect(within(first).getByText('Nothing needed on this trip.')).toBeTruthy()
    expect(within(first).getByText(/before lunch\. weekend shop/)).toBeTruthy()
  })

  it('without trips the list falls back to your shopping days, as before', async () => {
    await threeRecipes()
    const chicken = (await db.recipes.where('title').equals('Chicken and rice').first())!.id!
    await db.mealPlan.add({ date: addDays(TODAY, 1), slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
    open('/shopping')
    await screen.findByText('Chicken breast')
    expect(screen.queryByText(/No grocery trip in time/)).toBeNull()
    expect(screen.getAllByRole('heading', { level: 2 }).some((h) => /Meat/.test(h.textContent ?? ''))).toBe(true) // still by aisle
  })

  it('the plan screen links to the list and counts what is left to buy', async () => {
    await planAWeek()
    open('/plan')
    const link = (await screen.findByRole('link', { name: /^Shopping list \(\d+\)$/ })) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/shopping')
    expect(weekDays(TODAY)).toHaveLength(7)
  })
})

describe('the recipe screen ignores food that has gone off', () => {
  it('does not count expired pantry food as covering a recipe', async () => {
    const id = await addRecipe('Chicken and rice', [line('Chicken breast', 400), line('White rice', 200)])
    await stock('Chicken breast', 400, addDays(TODAY, -1)) // went off yesterday
    open(`/recipes/${id}`)
    await screen.findByRole('heading', { name: 'Chicken and rice' })
    expect(screen.queryByText(/In your pantry: 400 g/)).toBeNull()
    expect(screen.queryByText(/You have 400 g/)).toBeNull()
  })
})

describe('adding the plan to a calendar', () => {
  /** A download in jsdom: capture the file and its name instead of saving it. */
  const captureDownloads = () => {
    const files: { name: string; blob: Blob }[] = []
    let last: Blob | null = null
    URL.createObjectURL = (b: Blob | MediaSource) => {
      last = b as Blob
      return 'blob:test'
    }
    URL.revokeObjectURL = () => {}
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      files.push({ name: this.download, blob: last! })
    })
    return files
  }
  afterEach(() => vi.restoreAllMocks())

  it('saves an .ics file with your meals and grocery trips with what to buy', async () => {
    const files = captureDownloads()
    const { chicken } = await threeRecipes()
    await db.recipes.update(chicken, { estMinutes: 45 })
    const tomorrow = addDays(TODAY, 1)
    await db.mealPlan.bulkAdd([
      { date: tomorrow, slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' },
      { date: tomorrow, slot: 'lunch', constraint: 'out', servingsPlanned: 1, status: 'planned' },
    ])
    await db.trips.add({ date: TODAY, after: 'start', time: '09:30', note: 'weekend shop' })
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Add to calendar/ }))
    expect(await screen.findByText(/Saved meal-plan-[0-9-]+[.]ics with 3 events/)).toBeTruthy()
    expect(files).toHaveLength(1)
    expect(files[0].name).toBe(`meal-plan-${TODAY}.ics`)

    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(files[0].blob)
    })
    const events = new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent').map((v) => new ICAL.Event(v))
    const summaries = events.map((e) => e.summary).sort()
    expect(summaries).toEqual(['Dinner: Chicken and rice', 'Groceries', 'Lunch: eating out'])
    const shop = events.find((e) => e.summary === 'Groceries')!
    expect(shop.description).toContain('weekend shop')
    expect(shop.description).toContain('To buy:')
    expect(shop.description).toMatch(/- Chicken breast [0-9]+ g/)
  })

  it('says so when there is nothing to put on a calendar, and saves nothing', async () => {
    const files = captureDownloads()
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Add to calendar/ }))
    expect(await screen.findByText(/Nothing to add to a calendar yet/)).toBeTruthy()
    expect(files).toHaveLength(0)
  })

  it('explains how to import it, and that it is a file and not a live link', async () => {
    open('/plan')
    fireEvent.click(await screen.findByText('How to get it into Google Calendar'))
    expect(screen.getByText(/It is not a live link/)).toBeTruthy()
    expect(screen.getByText(/calendar[.]google[.]com/)).toBeTruthy()
  })
})

describe('a day that has already started', () => {
  it('does not plan a meal whose time has gone, but plans the rest of today', async () => {
    await threeRecipes()
    await fillerRecipes()
    vi.setSystemTime(new Date(`${TODAY}T15:00:00`)) // lunch is at 12:30, dinner at 18:30
    open('/plan')
    fireEvent.click(await screen.findByRole('button', { name: /Plan these days/ }))
    expect(await screen.findByText(/Planned 5 meals/)).toBeTruthy()
    const meals = await db.mealPlan.toArray()
    expect(meals.some((e) => e.date === TODAY && e.slot === 'lunch')).toBe(false)
    expect(meals.some((e) => e.date === TODAY && e.slot === 'dinner')).toBe(true)
    expect(await (await col(0)).findByRole('button', { name: /^Add lunch/ })).toBeTruthy() // still there to fill in by hand
  })
})
