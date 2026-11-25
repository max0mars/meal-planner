// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { db } from './db'
import { seedIfEmpty } from './lib/seed'

beforeAll(async () => {
  await seedIfEmpty()
})
afterEach(async () => {
  cleanup()
  await db.recipes.clear()
  await db.tagSensitivities.clear()
})

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

async function createRecipe(title: string, pastedLines: string, servings = '2') {
  open('/recipes/new')
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: title } })
  fireEvent.change(screen.getByLabelText('Servings'), { target: { value: servings } })
  fireEvent.click(screen.getByRole('button', { name: /paste a list/i }))
  fireEvent.change(screen.getByLabelText(/paste ingredients/i), { target: { value: pastedLines } })
  fireEvent.click(screen.getByRole('button', { name: /add to recipe/i }))
  fireEvent.click(screen.getByRole('button', { name: /save recipe/i }))
}

describe('recipe flow in the real app', () => {
  it('pastes ingredients, saves, and shows calories and protein per serving', async () => {
    await createRecipe('Egg scramble', '4 eggs\n100 ml whole milk\n1 tbsp olive oil')
    expect(await screen.findByRole('heading', { name: 'Egg scramble' })).toBeTruthy()
    const saved = (await db.recipes.toArray())[0]
    expect(saved.ingredients).toHaveLength(3)
    expect(saved.servings).toBe(2)
    // By hand: 4 eggs = 200 g (286 kcal, 25.2 g protein), 100 ml milk = 103 g (62.8 kcal, 3.3 g),
    // 1 tbsp olive oil = 13.6 g (120.3 kcal). Total 469.1 kcal and 28.5 g protein, over 2 servings:
    // 234.6 kcal rounds to 235, and 14.2 g protein rounds to 14.
    expect(screen.getByText('235')).toBeTruthy()
    expect(screen.getByText('14')).toBeTruthy()
    expect(screen.getByText('g protein per serving')).toBeTruthy()
    expect(screen.queryByText('Not recommended for you')).toBeNull()
  })

  it('shows a recipe with a Major-sensitivity food as not recommended, and hides it from the list', async () => {
    await db.tagSensitivities.put({ tag: 'gluten', sensitivity: 'major' })
    await createRecipe('Teriyaki chicken', '300 g chicken breast\n1 tbsp soy sauce')
    // The editor previews the same panel, so wait until the saved recipe page is showing.
    await screen.findByRole('heading', { name: 'Teriyaki chicken' })
    expect(await screen.findByText('Not recommended for you')).toBeTruthy()
    expect(screen.getByText(/Soy sauce: Major sensitivity \(gluten\)/)).toBeTruthy()

    cleanup()
    open('/recipes')
    expect(await screen.findByText(/1 hidden by your sensitivities/)).toBeTruthy()
    expect(screen.queryByText('Teriyaki chicken')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /show the 1 i should avoid/i }))
    expect(await screen.findByText('Teriyaki chicken')).toBeTruthy()
  })

  it('warns (but still offers) a recipe with a Light food within its limit', async () => {
    await db.tagSensitivities.put({ tag: 'onion-garlic', sensitivity: 'light' })
    await createRecipe('Chicken bowl', '400 g chicken breast\n200 g white rice\n20 g onion')
    await screen.findByRole('heading', { name: 'Chicken bowl' })
    expect(await screen.findByText('Contains foods you limit')).toBeTruthy()
    cleanup()
    open('/recipes')
    expect(await screen.findByText('Chicken bowl')).toBeTruthy()
    expect(screen.getByText(/Light: onion/)).toBeTruthy()
  })

  it('refuses to save until every ingredient has a food and an amount', async () => {
    open('/recipes/new')
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Mystery' } })
    fireEvent.click(screen.getByRole('button', { name: /paste a list/i }))
    fireEvent.change(screen.getByLabelText(/paste ingredients/i), { target: { value: '2 cups zzzunknownfood' } })
    fireEvent.click(screen.getByRole('button', { name: /add to recipe/i }))
    expect((screen.getByRole('button', { name: /save recipe/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Every ingredient needs a food and an amount.')).toBeTruthy()
    await waitFor(async () => expect(await db.recipes.count()).toBe(0))
  })
})

describe('pasting a real recipe into the form', () => {
  const recipe = `750g/1lb 10oz new potatoes
1 small unwaxed lemon, sliced
1 tbsp black onion seeds
1 x 280g jar sundried tomatoes in oil
¼ tsp caster sugar
2 whole fish (about 400g/14oz) such as sea bass, sea trout or Dover sole, cleaned
small bunch fresh parsley
small bunch lemon thyme
sea salt and freshly ground black pepper`

  it('fills in amounts, explains the estimates, and blocks saving until the unknown food is chosen', async () => {
    open('/recipes/new')
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Roast fish' } })
    fireEvent.click(screen.getByRole('button', { name: /paste a list/i }))
    fireEvent.change(screen.getByLabelText(/paste ingredients/i), { target: { value: recipe } })
    fireEvent.click(screen.getByRole('button', { name: /add to recipe/i }))

    // ten lines: the salt-and-pepper line became two
    expect(screen.getAllByLabelText('Amount')).toHaveLength(10)
    const amounts = (screen.getAllByLabelText('Amount') as HTMLInputElement[]).map((i) => i.value)
    expect(amounts).toEqual(['750', '1', '1', '280', '0.25', '800', '15', '15', '0.25', '0.25'])

    expect(screen.getAllByText(/Estimated from “small bunch”/)).toHaveLength(2)
    expect(screen.getByText(/The recipe lists several options. Picked Sea bass/)).toBeTruthy()
    expect(screen.getAllByText(/No amount given. Estimated a pinch/)).toHaveLength(2)
    expect(screen.getByText(/Couldn't find “black onion seeds” in your foods/)).toBeTruthy()

    // black onion seeds still needs a food, so saving is blocked and says why
    expect((screen.getByRole('button', { name: /save recipe/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Every ingredient needs a food and an amount.')).toBeTruthy()
  })
})

describe('repeated ingredients', () => {
  it('pasting the same food twice combines it into one line, and says so', async () => {
    open('/recipes/new')
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Fish pie' } })
    fireEvent.click(screen.getByRole('button', { name: /paste a list/i }))
    fireEvent.change(screen.getByLabelText(/paste ingredients/i), { target: { value: '250 g haddock\n250 g smoked haddock\n300 g potatoes' } })
    fireEvent.click(screen.getByRole('button', { name: /add to recipe/i }))
    const amounts = (screen.getAllByLabelText('Amount') as HTMLInputElement[]).map((i) => i.value)
    expect(amounts).toEqual(['500', '300']) // haddock once, as 500 g
    expect(screen.getByText(/Combined two lines of haddock/)).toBeTruthy()
  })

  it('a saved recipe with the same food on two lines reads as one on the recipe page', async () => {
    const haddock = (await db.ingredients.where('name').equals('Haddock').first())!
    const id = (await db.recipes.add({
      title: 'Old fish pie', servings: 4, servingsPerMeal: 1, steps: ['Bake.'], estMinutes: 40, actualMinutesHistory: [],
      ingredients: [{ ingredientId: haddock.id!, qty: 250, unit: 'g' }, { ingredientId: haddock.id!, qty: 250, unit: 'g' }],
    })) as number
    open(`/recipes/${id}`)
    await screen.findByRole('heading', { name: 'Old fish pie' })
    expect(screen.getAllByText('Haddock')).toHaveLength(1)
    expect(screen.getByText('500 g')).toBeTruthy()
    await db.recipes.delete(id)
  })
})
