// @vitest-environment jsdom
import './test/fakeServer'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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

  describe('flexible recipes', () => {
    const food = async (name: string) => (await db.ingredients.where('name').equals(name).first())!
    async function addPasta() {
      const [beef, wheat, gf, onion] = await Promise.all([food('Ground beef (80/20)'), food('Wheat pasta'), food('Gluten-free pasta'), food('Onion')])
      return (await db.recipes.add({
        title: 'Any meat pasta', servings: 4, servingsPerMeal: 1, steps: ['Cook.'], estMinutes: 30, actualMinutesHistory: [],
        ingredients: [
          { ingredientId: beef.id!, qty: 450, unit: 'g', anyCategory: 'meat', label: 'Meat' },
          { ingredientId: wheat.id!, qty: 340, unit: 'g', anyOf: [gf.id!], label: 'Pasta' },
          { ingredientId: onion.id!, qty: 1, unit: 'piece', optional: true },
        ],
      })) as number
    }

    it('shows each flexible line with its choice, and marks optional ones', async () => {
      const id = await addPasta()
      open(`/recipes/${id}`)
      await screen.findByRole('heading', { name: 'Any meat pasta' })
      const meat = screen.getByRole('combobox', { name: 'Meat' }) as HTMLSelectElement
      expect(meat.selectedOptions[0].textContent).toBe('Choose for me (Ground beef (80/20))')
      expect(meat.options.length).toBeGreaterThan(10) // every meat
      const pasta = screen.getByRole('combobox', { name: 'Pasta' }) as HTMLSelectElement
      expect([...pasta.options].map((o) => o.textContent)).toEqual(['Choose for me (Wheat pasta)', 'Wheat pasta', 'Gluten-free pasta'])
      expect(screen.getByText('Optional')).toBeTruthy()
    })

    it('swaps to a safe pasta and leaves out the optional onion for someone sensitive to both, so it is still offered', async () => {
      await db.tagSensitivities.bulkPut([{ tag: 'gluten', sensitivity: 'major' }, { tag: 'onion-garlic', sensitivity: 'major' }])
      const id = await addPasta()
      open(`/recipes/${id}`)
      await screen.findByRole('heading', { name: 'Any meat pasta' })
      const pasta = (await screen.findByRole('combobox', { name: 'Pasta' })) as HTMLSelectElement
      expect(pasta.selectedOptions[0].textContent).toBe('Choose for me (Gluten-free pasta)')
      expect(within(pasta).getByRole('option', { name: 'Wheat pasta (Major sensitivity)' })).toBeTruthy()
      expect(screen.getByText(/Left out, because it is optional and not safe for you: Onion \(Major sensitivity\)/)).toBeTruthy()
      expect(screen.queryByText('Not recommended for you')).toBeNull()
    })

    it('uses the meat in your pantry', async () => {
      const thigh = await food('Chicken thigh')
      await db.pantryItems.add({ ingredientId: thigh.id!, qty: 600, unit: 'g', purchasedOn: '2026-01-01', expiresOn: '2099-01-01', location: 'fridge' })
      const id = await addPasta()
      open(`/recipes/${id}`)
      const meat = (await screen.findByRole('combobox', { name: 'Meat' })) as HTMLSelectElement
      expect(meat.selectedOptions[0].textContent).toBe('Choose for me (Chicken thigh)')
      await db.pantryItems.clear()
    })

    it('lets you pick the meat from a dropdown on the ingredient, and go back to letting the app choose', async () => {
      const id = await addPasta()
      const thigh = await food('Chicken thigh')
      open(`/recipes/${id}`)
      const meat = (await screen.findByRole('combobox', { name: 'Meat' })) as HTMLSelectElement
      expect(meat.value).toBe('auto')
      expect(within(meat).getByRole('option', { name: 'Choose for me (Ground beef (80/20))' })).toBeTruthy()
      expect(within(meat).getByRole('option', { name: 'Chicken thigh' })).toBeTruthy()
      fireEvent.change(meat, { target: { value: String(thigh.id) } })
      await waitFor(async () => expect((await db.recipes.get(id))!.ingredients[0]).toMatchObject({ ingredientId: thigh.id, picked: true }))
      await waitFor(() => expect((screen.getByRole('combobox', { name: 'Meat' }) as HTMLSelectElement).value).toBe(String(thigh.id)))
      // the pick wins over what is in the pantry
      const pork = await food('Pork chop')
      await db.pantryItems.add({ ingredientId: pork.id!, qty: 600, unit: 'g', purchasedOn: '2026-01-01', expiresOn: '2099-01-01', location: 'fridge' })
      await waitFor(() => expect(within(screen.getByRole('combobox', { name: 'Meat' })).getByRole('option', { name: 'Choose for me (Pork chop)' })).toBeTruthy())
      expect((screen.getByRole('combobox', { name: 'Meat' }) as HTMLSelectElement).value).toBe(String(thigh.id))
      fireEvent.change(screen.getByRole('combobox', { name: 'Meat' }), { target: { value: 'auto' } })
      await waitFor(async () => expect((await db.recipes.get(id))!.ingredients[0].picked).toBeUndefined())
      await db.pantryItems.clear()
    })

    it('lets you leave out an optional food, which takes it out of the calories, and put it back', async () => {
      const id = await addPasta()
      open(`/recipes/${id}`)
      const use = (await screen.findByRole('checkbox', { name: 'Use Onion' })) as HTMLInputElement
      expect(use.checked).toBe(true)
      const kcal = () => Number(screen.getByText('kcal per serving').previousElementSibling!.textContent)
      const before = kcal()
      fireEvent.click(use)
      await waitFor(async () => expect((await db.recipes.get(id))!.ingredients[2].leftOut).toBe(true))
      await waitFor(() => expect(screen.getByText('Left out: not counted, and not on your shopping list')).toBeTruthy())
      expect((screen.getByRole('checkbox', { name: 'Use Onion' }) as HTMLInputElement).checked).toBe(false)
      expect(kcal()).toBeLessThan(before)
      fireEvent.click(screen.getByRole('checkbox', { name: 'Use Onion' }))
      await waitFor(async () => expect((await db.recipes.get(id))!.ingredients[2].leftOut).toBeUndefined())
      await waitFor(() => expect(kcal()).toBe(before))
    })

    it('says food in the pantry has gone off, rather than only that it is missing', async () => {
      const id = await addPasta()
      const onion = await food('Onion')
      await db.pantryItems.add({ ingredientId: onion.id!, qty: 3, unit: 'piece', purchasedOn: '2025-11-26', expiresOn: '2025-12-26', location: 'pantry' })
      open(`/recipes/${id}`)
      expect(await screen.findByText('Not in your pantry. Yours went off on Dec 26, 2025.')).toBeTruthy()
      await db.pantryItems.clear()
    })

    it('makes a line flexible and optional in the editor, and saves it', async () => {
      open('/recipes/new')
      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Rice and anything' } })
      fireEvent.click(screen.getByRole('button', { name: /paste a list/i }))
      fireEvent.change(screen.getByLabelText(/paste ingredients/i), { target: { value: '300 g chicken breast\n200 g white rice\n1 onion' } })
      fireEvent.click(screen.getByRole('button', { name: /add to recipe/i }))
      const flexible = screen.getAllByRole('checkbox', { name: /Flexible/ })
      fireEvent.click(flexible[0])
      // a flexible line needs a choice before it can be saved
      expect((screen.getByRole('button', { name: /save recipe/i }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.click(screen.getByRole('checkbox', { name: /Any meat/ }))
      fireEvent.change(screen.getByLabelText('Name for this ingredient'), { target: { value: 'Meat' } })
      fireEvent.click(screen.getAllByRole('checkbox', { name: 'Optional' })[2])
      fireEvent.click(screen.getByRole('button', { name: /save recipe/i }))
      await screen.findByRole('heading', { name: 'Rice and anything' })
      const saved = (await db.recipes.toArray())[0]
      expect(saved.ingredients[0]).toMatchObject({ anyCategory: 'meat', label: 'Meat' })
      expect(saved.ingredients[1].anyCategory).toBeUndefined()
      expect(saved.ingredients[2].optional).toBe(true)
    })
  })
})
