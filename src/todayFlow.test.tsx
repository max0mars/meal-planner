// @vitest-environment jsdom
import './test/fakeServer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { DEFAULT_SETTINGS, db } from './db'
import { addDays } from './lib/expiry'
import { todayIso } from './lib/pantry'
import { setFoods } from './lib/planEdit'
import { seedIfEmpty } from './lib/seed'
import type { RecipeIngredient, Unit } from './types'

const TODAY = todayIso()
const at = (time: string) => vi.setSystemTime(new Date(`${TODAY}T${time}:00`))

beforeAll(async () => {
  await seedIfEmpty()
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at('06:00')
})
afterEach(async () => {
  vi.useRealTimers()
  cleanup()
  await db.recipes.clear()
  await db.pantryItems.clear()
  await db.mealPlan.clear()
  await db.trips.clear()
  await db.settings.put({ ...DEFAULT_SETTINGS })
})

const open = () =>
  render(
    <MemoryRouter initialEntries={['/today']}>
      <App />
    </MemoryRouter>,
  )

async function line(name: string, qty: number, unit: Unit = 'g'): Promise<RecipeIngredient> {
  const food = (await db.ingredients.where('name').equals(name).first())!
  return { ingredientId: food.id!, qty, unit }
}
async function addRecipe(title: string, lines: Promise<RecipeIngredient>[], estMinutes = 30) {
  return (await db.recipes.add({
    title, servings: 4, servingsPerMeal: 1, ingredients: await Promise.all(lines), steps: ['Cook it.'], estMinutes, actualMinutesHistory: [],
  })) as number
}
const chickenAndRice = () => addRecipe('Chicken and rice', [line('Chicken breast', 400), line('White rice', 200), line('Broccoli', 200)], 45)
const beefStew = () => addRecipe('Beef stew', [line('Beef chuck roast', 500), line('Potato', 400), line('Carrot', 200)])
async function stock(name: string, qty: number, expiresOn: string) {
  const food = (await db.ingredients.where('name').equals(name).first())!
  await db.pantryItems.add({ ingredientId: food.id!, qty, unit: 'g', purchasedOn: addDays(TODAY, -2), expiresOn, location: 'fridge' })
}
const meal = (slot: 'lunch' | 'dinner' | 'snack', recipeId: number, over: Record<string, unknown> = {}) =>
  db.mealPlan.add({ date: TODAY, slot, recipeId, servingsPlanned: 1, status: 'planned', ...over } as never)
const cards = () => [...document.querySelectorAll<HTMLElement>('.today-meal')]

describe('the Today screen', () => {
  it('is the home screen: opening the app lands on Today', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy()
    // and its tab is the one marked as current
    const tab = [...document.querySelectorAll<HTMLAnchorElement>('nav a.tab')].find((a) => a.textContent === 'Today')!
    expect(tab.className).toContain('active')
  })

  it('shows the date and the meals planned for today, in the order you eat them, with what is next', async () => {
    const chicken = await chickenAndRice()
    const beef = await beefStew()
    await meal('dinner', chicken)
    await meal('lunch', beef)
    open()
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy()
    await waitFor(() => expect(cards()).toHaveLength(2))
    expect(within(cards()[0]).getByText('Lunch')).toBeTruthy()
    expect(within(cards()[0]).getByText('Up next')).toBeTruthy() // 6 AM: nothing has passed
    expect(within(cards()[0]).getByText('12:30 PM')).toBeTruthy()
    expect(within(cards()[1]).getByText('Dinner')).toBeTruthy()
    expect(within(cards()[1]).queryByText('Up next')).toBeNull()
    expect(within(cards()[1]).getByRole('link', { name: 'Chicken and rice' }).getAttribute('href')).toBe(`/recipes/${chicken}`)
    // the numbers for the meal, and how long the recipe takes
    expect(within(cards()[1]).getByText(/^\d+ kcal$/)).toBeTruthy()
    expect(within(cards()[1]).getByText(/^\d+ g protein$/)).toBeTruthy()
    expect(within(cards()[1]).getByText('45 min')).toBeTruthy()
    expect(within(cards()[1]).queryByText(/Start cooking/)).toBeNull()
  })

  it('marks a meal as made, moves "Up next" on, and can undo it', async () => {
    const chicken = await chickenAndRice()
    const beef = await beefStew()
    const lunch = (await meal('lunch', beef)) as number
    await meal('dinner', chicken)
    open()
    await waitFor(() => expect(cards()).toHaveLength(2))
    expect(within(cards()[0]).getByText('Up next')).toBeTruthy()
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Made it' }))
    await waitFor(async () => expect((await db.mealPlan.get(lunch))?.status).toBe('cooked'))
    await waitFor(() => expect(within(cards()[0]).getByText('Made')).toBeTruthy())
    expect(within(cards()[0]).queryByText(/Start cooking at/)).toBeNull()
    expect(within(cards()[1]).getByText('Up next')).toBeTruthy() // dinner is next now
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect((await db.mealPlan.get(lunch))?.status).toBe('planned'))
    await waitFor(() => expect(within(cards()[0]).getByText('Up next')).toBeTruthy())
  })

  it('takes what a meal used out of the pantry when you make it, and puts it back on Undo', async () => {
    const chicken = await chickenAndRice() // 400 g chicken, 200 g rice and 200 g broccoli, for 4 servings
    const entryId = (await meal('dinner', chicken, { servingsPlanned: 2 })) as number
    const breast = (await db.ingredients.where('name').equals('Chicken breast').first())!
    const rice = (await db.ingredients.where('name').equals('White rice').first())!
    const chickenLot = (await db.pantryItems.add({ ingredientId: breast.id!, qty: 500, unit: 'g', purchasedOn: TODAY, expiresOn: addDays(TODAY, 3), location: 'fridge' })) as number
    const riceLot = (await db.pantryItems.add({ ingredientId: rice.id!, qty: 100, unit: 'g', purchasedOn: TODAY, expiresOn: addDays(TODAY, 300), location: 'pantry' })) as number
    open()
    await waitFor(() => expect(cards()).toHaveLength(2))
    const dinner = () => cards().find((c) => within(c).queryByText('Dinner'))!
    fireEvent.click(within(dinner()).getByRole('button', { name: 'Made it' }))
    // 2 of 4 servings: 200 g of the chicken, and the 100 g of rice there was (it needed 100 g)
    await waitFor(async () => expect((await db.pantryItems.get(chickenLot))?.qty).toBe(300))
    expect(await db.pantryItems.get(riceLot)).toBeUndefined()
    await waitFor(() => expect(within(dinner()).getByText(/Taken from your pantry: Chicken breast, White rice/)).toBeTruthy())
    fireEvent.click(within(dinner()).getByRole('button', { name: 'Undo' }))
    await waitFor(async () => expect((await db.mealPlan.get(entryId))?.status).toBe('planned'))
    expect((await db.pantryItems.get(chickenLot))?.qty).toBe(500)
    expect((await db.pantryItems.get(riceLot))?.qty).toBe(100)
  })

  describe('a meal of plain foods, with no recipe', () => {
    const pick = async (dialog: ReturnType<typeof within>, box: RegExp, search: string, name: string) => {
      fireEvent.change(dialog.getByLabelText(box), { target: { value: search } })
      fireEvent.click(await dialog.findByRole('button', { name }))
    }

    it('logs 3 eggs, a slice of toast and a borrowed apple as eaten, taking only your own food out of the pantry', async () => {
      at('13:00') // lunch (12:30) has gone, so it starts ticked as eaten
      const egg = (await db.ingredients.where('name').equals('Eggs').first())!
      const apple = (await db.ingredients.where('name').equals('Apple').first())!
      const eggs = (await db.pantryItems.add({ ingredientId: egg.id!, qty: 12, unit: 'piece', purchasedOn: TODAY, expiresOn: addDays(TODAY, 20), location: 'fridge' })) as number
      const apples = (await db.pantryItems.add({ ingredientId: apple.id!, qty: 4, unit: 'piece', purchasedOn: TODAY, expiresOn: addDays(TODAY, 20), location: 'fridge' })) as number
      open()
      await waitFor(() => expect(cards().length).toBeGreaterThan(0))
      const lunch = () => cards().find((c) => within(c).queryByText('Lunch'))!
      fireEvent.click(within(lunch()).getByRole('button', { name: 'Add foods' }))
      const dialog = within(screen.getByRole('dialog'))
      await pick(dialog, /What did you have/, 'eggs', 'Eggs')
      fireEvent.change(dialog.getByLabelText('Amount of Eggs'), { target: { value: '3' } })
      await pick(dialog, /Add another food/, 'white bread', 'White bread')
      await pick(dialog, /Add another food/, 'apple', 'Apple')
      fireEvent.click(dialog.getByRole('checkbox', { name: 'Borrowed Apple' }))
      // 3 x 50 g eggs (215 kcal), a 28 g slice (74 kcal) and a 182 g apple (95 kcal)
      expect(dialog.getByText(/kcal/).textContent).toMatch(/^384 kcal/)
      expect((dialog.getByRole('checkbox', { name: /eaten it/ }) as HTMLInputElement).checked).toBe(true)
      fireEvent.click(dialog.getByRole('button', { name: 'Save meal' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      const entry = (await db.mealPlan.toArray()).find((e) => e.slot === 'lunch')!
      expect(entry).toMatchObject({ status: 'cooked', borrowed: [apple.id] })
      // the foods are kept on the meal itself: no recipe is made
      expect(entry.recipeId).toBeUndefined()
      expect(entry.foods!.map((f) => [f.ingredientId, f.qty, f.unit])).toEqual([
        [egg.id, 3, 'piece'],
        [(await db.ingredients.where('name').equals('White bread').first())!.id, 1, 'piece'],
        [apple.id, 1, 'piece'],
      ])
      expect(await db.recipes.count()).toBe(0)
      expect((await db.pantryItems.get(eggs))?.qty).toBe(9)
      expect((await db.pantryItems.get(apples))?.qty).toBe(4) // borrowed: yours are untouched
      await waitFor(() => expect(within(lunch()).getByText('Eaten')).toBeTruthy())
      expect(within(lunch()).getByText('Eggs, White bread and Apple')).toBeTruthy()
      expect(within(lunch()).getByText('384 kcal')).toBeTruthy()
      expect(within(lunch()).queryByText(/Start cooking/)).toBeNull()
      // the day's totals count it
      expect(document.querySelector('.today-totals')!.textContent).toContain('384')
    })

    it('changes the foods of a meal: take one away and add another', async () => {
      const egg = (await db.ingredients.where('name').equals('Eggs').first())!
      const toast = (await db.ingredients.where('name').equals('White bread').first())!
      const id = await setFoods(TODAY, 'lunch', [
        { ingredientId: egg.id!, qty: 2, unit: 'piece' },
        { ingredientId: toast.id!, qty: 1, unit: 'piece' },
      ])
      open()
      await waitFor(() => expect(cards().length).toBeGreaterThan(0))
      const lunch = () => cards().find((c) => within(c).queryByText('Lunch'))!
      expect(within(lunch()).getByText('Eggs and White bread')).toBeTruthy()
      fireEvent.click(within(lunch()).getByRole('button', { name: 'Edit foods' }))
      const dialog = within(screen.getByRole('dialog'))
      expect((dialog.getByLabelText('Amount of Eggs') as HTMLInputElement).value).toBe('2')
      fireEvent.click(dialog.getByRole('button', { name: 'Remove White bread' }))
      await pick(dialog, /Add another food/, 'banana', 'Banana')
      fireEvent.click(dialog.getByRole('button', { name: 'Save changes' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await waitFor(() => expect(within(lunch()).getByText('Eggs and Banana')).toBeTruthy())
      expect((await db.mealPlan.get(id))!.foods!.map((f) => f.ingredientId)).toEqual([egg.id, (await db.ingredients.where('name').equals('Banana').first())!.id])
      expect(await db.mealPlan.count()).toBe(1)
    })

    it('offers foods for a meal whose recipe was deleted, and replaces it', async () => {
      const chicken = await chickenAndRice()
      const id = (await meal('lunch', chicken)) as number
      await db.recipes.delete(chicken)
      open()
      await waitFor(() => expect(cards().length).toBeGreaterThan(0))
      const lunch = () => cards().find((c) => within(c).queryByText('Lunch'))!
      expect(within(lunch()).getByText('Recipe deleted')).toBeTruthy()
      fireEvent.click(within(lunch()).getByRole('button', { name: 'Add foods' }))
      const dialog = within(screen.getByRole('dialog'))
      await pick(dialog, /What did you have/, 'eggs', 'Eggs')
      fireEvent.click(dialog.getByRole('button', { name: 'Save meal' }))
      await waitFor(() => expect(within(lunch()).getByText('Eggs')).toBeTruthy())
      const entry = (await db.mealPlan.get(id))!
      expect(entry.recipeId).toBeUndefined()
      expect(entry.foods).toHaveLength(1)
    })
  })

  it('takes the calories and protein of a meal out, and counts them in the day', async () => {
    const id = (await db.mealPlan.add({ date: TODAY, slot: 'dinner', constraint: 'out', servingsPlanned: 1, status: 'planned' })) as number
    open()
    await waitFor(() => expect(cards().length).toBeGreaterThan(0))
    const dinner = () => cards().find((c) => within(c).queryByText('Dinner'))!
    expect(within(dinner()).getByText('Eating out')).toBeTruthy()
    const kcal = within(dinner()).getByLabelText('Calories eating out') as HTMLInputElement
    expect(kcal.value).toBe('') // not known yet: counts as nothing
    expect(document.querySelector('.today-totals')!.textContent).toMatch(/^0 of /)
    fireEvent.change(kcal, { target: { value: '850' } })
    fireEvent.change(within(dinner()).getByLabelText('Protein eating out'), { target: { value: '40' } })
    await waitFor(async () => expect(await db.mealPlan.get(id)).toMatchObject({ outKcal: 850, outProtein: 40 }))
    await waitFor(() => expect(document.querySelector('.today-totals')!.textContent).toContain('850 of'))
    expect(document.querySelector('.today-totals')!.textContent).toContain('40 of')
    // emptying a box forgets that number
    fireEvent.change(within(dinner()).getByLabelText('Protein eating out'), { target: { value: '' } })
    await waitFor(async () => expect((await db.mealPlan.get(id))?.outProtein).toBeUndefined())
    expect((await db.mealPlan.get(id))?.outKcal).toBe(850)
  })

  it('removes a meal from today without deleting its recipe', async () => {
    const chicken = await chickenAndRice()
    await meal('dinner', chicken)
    open()
    await waitFor(() => expect(cards().length).toBeGreaterThan(0))
    const dinner = () => cards().find((c) => within(c).queryByText('Dinner'))!
    expect(within(dinner()).getByRole('link', { name: 'Chicken and rice' })).toBeTruthy()
    fireEvent.click(within(dinner()).getByRole('button', { name: 'Remove dinner from today' }))
    await waitFor(() => expect(within(dinner()).getByText('Nothing planned')).toBeTruthy())
    expect(await db.mealPlan.count()).toBe(0)
    expect(await db.recipes.get(chicken)).toBeTruthy() // still one of your recipes
  })

  it('does not offer Remove on a meal you have made: Undo comes first', async () => {
    const chicken = await chickenAndRice()
    await meal('dinner', chicken, { status: 'cooked' })
    open()
    await waitFor(() => expect(cards().length).toBeGreaterThan(0))
    const dinner = cards().find((c) => within(c).queryByText('Dinner'))!
    expect(within(dinner).getByRole('button', { name: 'Undo' })).toBeTruthy()
    expect(within(dinner).queryByRole('button', { name: /^Remove/ })).toBeNull()
  })

  it('says "Ate it" for leftovers', async () => {
    const chicken = await chickenAndRice()
    await db.mealPlan.add({ date: addDays(TODAY, -1), slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'cooked' })
    await meal('lunch', chicken)
    open()
    await waitFor(() => expect(cards().length).toBeGreaterThan(0))
    const lunch = cards().find((c) => within(c).queryByText('Lunch'))!
    expect(within(lunch).getByText('Leftovers, nothing to cook')).toBeTruthy()
    const broccoli = (await db.ingredients.where('name').equals('Broccoli').first())!
    const lot = (await db.pantryItems.add({ ingredientId: broccoli.id!, qty: 300, unit: 'g', purchasedOn: TODAY, expiresOn: addDays(TODAY, 5), location: 'fridge' })) as number
    fireEvent.click(within(lunch).getByRole('button', { name: 'Ate it' }))
    await waitFor(() => expect(within(cards().find((c) => within(c).queryByText('Lunch'))!).getByText('Eaten')).toBeTruthy())
    expect((await db.pantryItems.get(lot))?.qty).toBe(300) // leftovers take nothing: that food went when it was cooked
  })

  it('goes back to Today from a recipe opened there', async () => {
    const chicken = await chickenAndRice()
    await meal('dinner', chicken)
    open()
    fireEvent.click(await screen.findByRole('link', { name: 'Chicken and rice' }))
    await screen.findByRole('heading', { name: 'Chicken and rice' })
    const back = document.querySelector('a.back') as HTMLAnchorElement // the tab bar has a link with the same name
    expect(back.textContent).toContain('Today')
    expect(back.getAttribute('href')).toBe('/today')
    fireEvent.click(back)
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Recipes' })).toBeNull()
  })

  it('adds up the day against your targets', async () => {
    const chicken = await chickenAndRice()
    await meal('dinner', chicken)
    open()
    const totals = await screen.findByLabelText('Today against your targets')
    expect(await within(totals).findByText(/of 3,000 kcal/)).toBeTruthy()
    expect(within(totals).getByText(/of 150 g protein/)).toBeTruthy()
  })

  it('marks a meal as earlier once its time has gone, and moves "Up next" on', async () => {
    const chicken = await chickenAndRice()
    const beef = await beefStew()
    await meal('lunch', beef)
    await meal('dinner', chicken)
    at('14:00')
    open()
    await waitFor(() => expect(cards()).toHaveLength(2))
    expect(within(cards()[0]).getByText('Earlier')).toBeTruthy()
    expect(within(cards()[1]).getByText('Up next')).toBeTruthy()
  })

  it('shows meals in 24-hour time when that is the setting', async () => {
    await db.settings.put({ ...DEFAULT_SETTINGS, timeFormat: '24h' })
    await meal('dinner', await chickenAndRice())
    open()
    await waitFor(() => expect(cards().length).toBeGreaterThan(0))
    const dinner = cards().find((c) => within(c).queryByText('Dinner'))!
    expect(within(dinner).getByText('18:30')).toBeTruthy()

  })

  it('says so when nothing is planned, and offers the plan', async () => {
    open()
    expect(await screen.findByText('Nothing is planned for today yet.')).toBeTruthy()
    await waitFor(() => expect(cards()).toHaveLength(2)) // lunch and dinner, both empty
    expect(screen.getAllByText('Nothing planned')).toHaveLength(2)
    expect(screen.getByRole('link', { name: /Plan today/ }).getAttribute('href')).toBe('/plan')
  })

  it('explains meals that are eating out, leftovers, or not planned yet', async () => {
    await db.mealPlan.add({ date: TODAY, slot: 'lunch', servingsPlanned: 1, status: 'planned', constraint: 'out' })
    await db.mealPlan.add({ date: TODAY, slot: 'dinner', servingsPlanned: 1, status: 'planned', constraint: 'quick' })
    open()
    expect(await screen.findByText('Eating out')).toBeTruthy()
    expect(screen.getByText('Little time, not planned yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Choose a recipe on the plan' }).getAttribute('href')).toBe('/plan')
  })

  it('says a leftover meal needs no cooking', async () => {
    const chicken = await chickenAndRice()
    await db.mealPlan.add({ date: addDays(TODAY, -1), slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' }) // cooked last night
    await meal('lunch', chicken)
    open()
    await waitFor(() => expect(cards().length).toBeGreaterThan(0))
    const lunch = cards().find((c) => within(c).queryByText('Lunch'))!
    expect(await within(lunch).findByText('Leftovers, nothing to cook')).toBeTruthy()
  })

  it('lists food to use soon with how long is left, and nothing else', async () => {
    await stock('Chicken breast', 400, addDays(TODAY, 2))
    await stock('Spinach', 100, addDays(TODAY, -1)) // past its date
    await stock('White rice', 900, addDays(TODAY, 200)) // not soon
    open()
    expect(await screen.findByText('Chicken breast')).toBeTruthy()
    const soon = [...document.querySelectorAll<HTMLElement>('.today-soon')]
    expect(soon).toHaveLength(2)
    expect(within(soon[0]).getByText('Spinach')).toBeTruthy() // soonest first
    expect(soon[0].textContent).toContain('1 day past')
    expect(soon[1].textContent).toContain('2 days left')
    expect(screen.queryByText('White rice')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open the pantry' }).getAttribute('href')).toBe('/pantry')
  })

  it('suggests meals that use up what is about to go off', async () => {
    await chickenAndRice()
    await beefStew()
    await stock('Chicken breast', 500, addDays(TODAY, 2))
    await stock('White rice', 500, addDays(TODAY, 90))
    await stock('Broccoli', 300, addDays(TODAY, 20))
    open()
    expect(await screen.findByText('Cook with it')).toBeTruthy()
    const idea = await screen.findByRole('link', { name: 'Chicken and rice' })
    expect(idea.getAttribute('href')).toMatch(/^\/recipes\/\d+$/)
    expect(screen.getByText('Uses up chicken breast')).toBeTruthy()
    expect(screen.getByText('You have everything')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Beef stew' })).toBeNull() // nothing of it is in the pantry
  })

  it('says when nothing is about to go off, and suggests nothing', async () => {
    await chickenAndRice()
    await stock('Chicken breast', 500, addDays(TODAY, 30))
    open()
    expect(await screen.findByText('Nothing in your pantry is about to go off.')).toBeTruthy()
    expect(screen.queryByText('Cook with it')).toBeNull()
  })

  describe('the missing-ingredients warning', () => {
    it('warns when something is missing and the first grocery trip comes too late', async () => {
      const chicken = await chickenAndRice()
      await meal('dinner', chicken) // needs chicken, rice and broccoli today, and the pantry is empty
      await db.trips.add({ date: addDays(TODAY, 2), after: 'start', time: '10:00' }) // the only trip is in two days
      open()
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('3 ingredients missing and not scheduled in time')
      expect(alert.textContent).toContain('Chicken breast')
      expect(within(alert).getByRole('link', { name: 'Schedule groceries' }).getAttribute('href')).toBe('/plan')
      expect(within(alert).getByRole('link', { name: 'See the shopping list' }).getAttribute('href')).toBe('/shopping')
    })

    it('does not warn when a trip comes before the ingredients are needed', async () => {
      await meal('dinner', await chickenAndRice())
      await db.trips.add({ date: TODAY, after: 'start', time: '11:00' }) // this morning, before dinner
      open()
      await screen.findByRole('heading', { name: 'Today' })
      await waitFor(() => expect(cards().length).toBeGreaterThan(0))
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('warns about what is needed today or tomorrow when there are no trips at all', async () => {
      await meal('dinner', await chickenAndRice())
      open()
      expect((await screen.findByRole('alert')).textContent).toContain('3 ingredients missing and not scheduled in time')
    })

    it('warns about things needed later too when there are no trips at all', async () => {
      const chicken = await chickenAndRice()
      await db.mealPlan.add({ date: addDays(TODAY, 4), slot: 'dinner', recipeId: chicken, servingsPlanned: 1, status: 'planned' })
      open()
      expect((await screen.findByRole('alert')).textContent).toContain('missing and not scheduled in time')
    })

    it('does not warn when nothing is planned', async () => {
      open()
      await screen.findByRole('heading', { name: 'Today' })
      expect(screen.queryByRole('alert')).toBeNull()
    })

    it('says "1 ingredient" for one, and lists only the first few names', async () => {
      const salmon = await addRecipe('Plain salmon', [line('Salmon', 400)])
      await meal('dinner', salmon)
      open()
      expect((await screen.findByRole('alert')).textContent).toContain('1 ingredient missing and not scheduled in time')
    })

    it('is not shown when you already have everything', async () => {
      const chicken = await chickenAndRice()
      await meal('dinner', chicken)
      await stock('Chicken breast', 500, addDays(TODAY, 20))
      await stock('White rice', 500, addDays(TODAY, 200))
      await stock('Broccoli', 500, addDays(TODAY, 20))
      open()
      await screen.findByRole('heading', { name: 'Today' })
      await waitFor(() => expect(cards().length).toBeGreaterThan(0))
      expect(screen.queryByRole('alert')).toBeNull()
    })
  })

  it('shows a grocery trip planned for today, and links to the list', async () => {
    await db.trips.add({ date: TODAY, after: 'start', time: '11:00', note: 'big shop' })
    await db.trips.add({ date: addDays(TODAY, 1), after: 'start', time: '09:00' }) // tomorrow: not shown
    open()
    expect(await screen.findByText('Groceries today')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: 'Grocery trip time' }) as HTMLSelectElement).value).toBe('11:00')
    expect(screen.getByText(/, before lunch/)).toBeTruthy()
    expect(screen.getByText('big shop')).toBeTruthy()
    expect(screen.getAllByRole('combobox', { name: 'Grocery trip time' })).toHaveLength(1) // tomorrow's trip is not shown
    expect(screen.getByRole('link', { name: /Open the shopping list|things? to buy/ }).getAttribute('href')).toBe('/shopping')
  })

  it('changes a grocery trip time from a half-hour dropdown', async () => {
    const id = (await db.trips.add({ date: TODAY, after: 'start', time: '11:00' })) as number
    open()
    const pick = (await screen.findByRole('combobox', { name: 'Grocery trip time' })) as HTMLSelectElement
    expect(pick.options).toHaveLength(48)
    expect(pick.options[1].value).toBe('00:30')
    fireEvent.change(pick, { target: { value: '10:30' } })
    await waitFor(async () => expect((await db.trips.get(id))?.time).toBe('10:30'))
  })

  it('changes when you eat a planned meal from a half-hour dropdown, and keeps an off-the-half-hour time listed', async () => {
    const chicken = await chickenAndRice()
    const id = (await meal('dinner', chicken, { eatAt: '18:45' })) as number
    open()
    const pick = (await screen.findByRole('combobox', { name: 'Dinner time' })) as HTMLSelectElement
    expect(pick.value).toBe('18:45')
    expect(pick.options).toHaveLength(49)
    fireEvent.change(pick, { target: { value: '19:30' } })
    await waitFor(async () => expect((await db.mealPlan.get(id))?.eatAt).toBe('19:30'))

  })

  it('has no grocery section when there is no trip today', async () => {
    open()
    await screen.findByRole('heading', { name: 'Today' })
    expect(screen.queryByText('Groceries today')).toBeNull()
  })
})
