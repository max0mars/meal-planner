// @vitest-environment jsdom
import './test/fakeServer'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { db } from './db'
import { addDays } from './lib/expiry'
import { todayIso } from './lib/pantry'
import { seedIfEmpty } from './lib/seed'
import { seedBaselineRecipes } from './lib/seedRecipes'
import type { Unit } from './types'

// Thai beef stir-fry makes 4: 400 g beef, 2 tbsp oil, 1 chilli, 2 tbsp oyster sauce, 10 g basil.
let id: number

beforeAll(async () => {
  await seedIfEmpty()
  await seedBaselineRecipes()
  id = (await db.recipes.filter((r) => r.title === 'Thai beef stir-fry').first())!.id!
})
afterEach(async () => {
  cleanup()
  await db.pantryItems.clear()
})

const open = () =>
  render(
    <MemoryRouter initialEntries={[`/recipes/${id}`]}>
      <App />
    </MemoryRouter>,
  )

const list = () => document.querySelector('.rows') as HTMLElement

async function stockUp(name: string, qty: number, unit: Unit = 'g') {
  const food = (await db.ingredients.where('name').equals(name).first())!
  await db.pantryItems.add({ ingredientId: food.id!, qty, unit, purchasedOn: todayIso(), expiresOn: addDays(todayIso(), 30), location: 'fridge' })
}

describe('cooking more or less than the recipe makes', () => {
  it('scales every amount by the number of servings, and shows the originals and the totals', async () => {
    open()
    await screen.findByRole('heading', { name: 'Thai beef stir-fry' })
    expect(within(list()).getByText('400 g')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Cook more servings' })) // 4 -> 5, so x1.25
    expect(await within(list()).findByText('500 g')).toBeTruthy() // beef
    expect(within(list()).getAllByText('2½ tbsp')).toHaveLength(2) // oil and oyster sauce: 2 x 1.25
    expect(within(list()).getByText('recipe: 400 g')).toBeTruthy()
    expect(screen.getByText(/every amount is ×1.3/)).toBeTruthy()
    expect(screen.getByText(/In total that is/)).toBeTruthy()
  })

  it('goes down as well as up, but not below one serving', async () => {
    open()
    const fewer = (await screen.findByRole('button', { name: 'Cook fewer servings' })) as HTMLButtonElement
    fireEvent.click(fewer) // 3
    fireEvent.click(fewer) // 2
    expect(await within(list()).findByText('200 g')).toBeTruthy()
    fireEvent.click(fewer) // 1
    expect(await within(list()).findByText('100 g')).toBeTruthy()
    expect(fewer.disabled).toBe(true)
  })

  it('resets to the recipe as written', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Cook more servings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Reset to 4' }))
    expect(await within(list()).findByText('400 g')).toBeTruthy()
    expect(within(list()).queryByText(/recipe:/)).toBeNull()
  })

  it('never changes the saved recipe', async () => {
    const before = await db.recipes.get(id)
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Cook more servings' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cook more servings' }))
    await within(list()).findByText('600 g')
    const after = await db.recipes.get(id)
    expect(after!.servings).toBe(before!.servings)
    expect(after!.ingredients).toEqual(before!.ingredients)
  })

  it('leaves the per-serving numbers alone, since a serving is still a serving', async () => {
    open()
    await screen.findByRole('heading', { name: 'Thai beef stir-fry' })
    const stats = document.querySelector('.stats') as HTMLElement
    const before = stats.textContent
    fireEvent.click(screen.getByRole('button', { name: 'Cook more servings' }))
    await within(list()).findByText('500 g')
    expect(stats.textContent).toBe(before)
  })
})

describe('scaling to what you have', () => {
  const choose = async () => {
    open()
    await screen.findByRole('heading', { name: 'Thai beef stir-fry' })
    fireEvent.click(screen.getByText('Or scale to what I have'))
  }
  /** The ingredient list starts with the oil, so pick the beef (the second line) before entering an amount. */
  const pickBeef = () => fireEvent.change(screen.getByLabelText('Or scale by one ingredient'), { target: { value: '1' } })

  it('scales the whole recipe from the amount of one ingredient', async () => {
    await choose()
    pickBeef() // 400 g in the recipe, so 200 g of it is half a batch
    fireEvent.change(screen.getByLabelText(/How much do you have/), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Scale the recipe' }))
    expect(await within(list()).findByText('200 g')).toBeTruthy()
    expect(within(list()).getAllByText('1 tbsp')).toHaveLength(2) // 2 tbsp of oil and of oyster sauce, halved
    expect(screen.getByText(/every amount is ×0.5/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Reset to 4' })).toBeTruthy()
  })

  it('offers the other ingredients too, in the recipe\'s own units', async () => {
    await choose()
    const options = within(screen.getByLabelText('Or scale by one ingredient')).getAllByRole('option').map((o) => o.textContent)
    expect(options.some((o) => /Beef chuck roast \(400 g in the recipe\)/.test(o ?? ''))).toBe(true)
    expect(options.some((o) => /Canola oil \(2 tbsp in the recipe\)/.test(o ?? ''))).toBe(true)
    expect(options.some((o) => /Basil/.test(o ?? ''))).toBe(false) // herbs and spices are never the limit
  })

  it('does nothing until you enter an amount', async () => {
    await choose()
    expect((screen.getByRole('button', { name: 'Scale the recipe' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('uses the amount in your pantry with one tap', async () => {
    await stockUp('Beef chuck roast', 600)
    await choose()
    pickBeef()
    fireEvent.click(await screen.findByRole('button', { name: /Use all my beef chuck roast \(600 g\)/ }))
    expect(await within(list()).findByText('600 g')).toBeTruthy() // 6 servings: x1.5
    expect(screen.getByText(/every amount is ×1.5/)).toBeTruthy()
  })
})

describe('how your pantry covers the recipe', () => {
  it('says nothing about the pantry while it is empty', async () => {
    open()
    await screen.findByRole('heading', { name: 'Thai beef stir-fry' })
    expect(within(list()).queryByText(/In your pantry|Not in your pantry|Short by/)).toBeNull()
  })

  it('marks each ingredient as covered, short, or missing', async () => {
    await stockUp('Beef chuck roast', 300) // needs 400
    await stockUp('Oyster sauce', 100, 'ml') // needs about 30 ml
    open()
    await screen.findByRole('heading', { name: 'Thai beef stir-fry' })
    expect(await within(list()).findByText('Short by 100 g. You have 300 g.')).toBeTruthy()
    expect(within(list()).getByText(/In your pantry: 120 g/)).toBeTruthy() // 100 ml of oyster sauce is 120 g
    expect(within(list()).getAllByText('Not in your pantry').length).toBeGreaterThan(0) // oil, chilli
  })

  it('re-checks the pantry when you scale up', async () => {
    await stockUp('Beef chuck roast', 450)
    open()
    await screen.findByRole('heading', { name: 'Thai beef stir-fry' })
    expect(await within(list()).findByText(/In your pantry: 450 g/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cook more servings' })) // needs 500 g
    expect(await within(list()).findByText('Short by 50 g. You have 450 g.')).toBeTruthy()
  })

  it('works out the most you can make, and which ingredient runs out first', async () => {
    await stockUp('Beef chuck roast', 800)
    await stockUp('Canola oil', 100, 'ml')
    await stockUp('Chili pepper (fresh)', 3, 'piece')
    await stockUp('Oyster sauce', 100, 'ml')
    await stockUp('Basil (fresh)', 50)
    open()
    fireEvent.click(await screen.findByText('Or scale to what I have'))
    expect(await screen.findByText(/Your pantry covers about 8 servings, running out of beef chuck roast first/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use my pantry: cook 8 servings' }))
    expect(await within(list()).findByText('800 g')).toBeTruthy()
  })

  it('lists what is missing instead of guessing a maximum', async () => {
    await stockUp('Beef chuck roast', 800)
    open()
    fireEvent.click(await screen.findByText('Or scale to what I have'))
    expect(await screen.findByText(/Not in your pantry: .*canola oil/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Use my pantry:/ })).toBeNull()
  })

  it('does not let a missing seasoning or water block the maximum', async () => {
    // the recipe's herbs (basil) are assumed to be in the cupboard, so they are not asked for
    await stockUp('Beef chuck roast', 800)
    await stockUp('Canola oil', 100, 'ml')
    await stockUp('Chili pepper (fresh)', 3, 'piece')
    await stockUp('Oyster sauce', 100, 'ml')
    open()
    fireEvent.click(await screen.findByText('Or scale to what I have'))
    await waitFor(() => expect(screen.getByText(/Your pantry covers about 8 servings/)).toBeTruthy())
    expect(screen.queryByText(/Not in your pantry: .*basil/)).toBeNull()
  })

  it('does not let a missing optional food block it, and cooks what the pantry covers in one tap', async () => {
    // the chilli is optional here, and there is none: the most you can make still comes from the rest
    const before = (await db.recipes.get(id))!
    const chilli = (await db.ingredients.where('name').equals('Chili pepper (fresh)').first())!
    await db.recipes.update(id, { ingredients: before.ingredients.map((l) => (l.ingredientId === chilli.id ? { ...l, optional: true } : l)) })
    try {
      await stockUp('Beef chuck roast', 800)
      await stockUp('Canola oil', 100, 'ml')
      await stockUp('Oyster sauce', 100, 'ml')
      open()
      fireEvent.click(await screen.findByText('Or scale to what I have'))
      expect(await screen.findByText(/Your pantry covers about 8 servings, running out of beef chuck roast first/)).toBeTruthy()
      expect(screen.queryByText(/Not in your pantry: .*chili/)).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Use my pantry: cook 8 servings' }))
      expect(await within(list()).findByText('800 g')).toBeTruthy()
      expect(screen.getByText(/every amount is ×2/)).toBeTruthy()
    } finally {
      await db.recipes.put(before)
    }
  })
})
