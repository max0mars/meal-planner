// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { DEFAULT_SETTINGS, db } from './db'
import { addDays } from './lib/expiry'
import { todayIso } from './lib/pantry'
import { seedIfEmpty } from './lib/seed'

// jsdom cannot read an image, so only the reading step is replaced. Parsing, the review screen and saving are the real code.
const engine = vi.hoisted(() => ({ recognizeReceipt: vi.fn() }))
vi.mock('./lib/ocrEngine', () => ({ recognizeReceipt: engine.recognizeReceipt, preprocess: async (f: Blob) => f }))

const TODAY = todayIso()
const BOUGHT = addDays(TODAY, -3)
const ukDate = (iso: string) => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

const RECEIPT = [
  'TESCO',
  'Extra Store 1234',
  `${ukDate(BOUGHT)} 17:42`,
  'BRITISH CHICKEN BREAST 500G   4.25 A',
  'SEMI SKIMMED MILK 2L   1.55 A',
  'CARROTS LOOSE',
  '0.452 kg @ £1.20/kg   0.54',
  'FREE RANGE EGGS 12  3.15',
  'KITCHEN ROLL 2PK  1.80',
  'ZZQX GLORP  2.00',
  'SUBTOTAL  13.29',
  'TOTAL  13.29',
  'VISA CONTACTLESS  13.29',
].join('\n')

const fetchMock = vi.fn(async () => {
  throw new Error('the receipt flow must not use the network')
})

beforeAll(async () => {
  await seedIfEmpty()
})
beforeEach(() => {
  engine.recognizeReceipt.mockReset().mockResolvedValue(RECEIPT)
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  await db.pantryItems.clear()
  await db.mealPlan.clear()
  await db.recipes.clear()
  await db.settings.put({ ...DEFAULT_SETTINGS })
})

const open = () =>
  render(
    <MemoryRouter initialEntries={['/pantry']}>
      <App />
    </MemoryRouter>,
  )
const photo = () => new File(['not really an image'], 'receipt.jpg', { type: 'image/jpeg' })
async function scan() {
  open()
  fireEvent.click(await screen.findByRole('button', { name: /Scan a receipt/ }))
  fireEvent.change(await screen.findByLabelText('Receipt photo'), { target: { files: [photo()] } })
  return within(await screen.findByRole('dialog', { name: 'Check your receipt' }))
}
const food = async (name: string) => (await db.ingredients.where('name').equals(name).first())!

describe('scanning a receipt', () => {
  it('shows what was read for you to check, and adds nothing yet', async () => {
    const review = await scan()
    expect(review.getByText('Chicken breast')).toBeTruthy()
    expect((review.getByLabelText('Amount of Chicken breast') as HTMLInputElement).value).toBe('500')
    expect((review.getByLabelText('Unit for Chicken breast') as HTMLSelectElement).value).toBe('g')
    expect((review.getByLabelText('Amount of Carrot') as HTMLInputElement).value).toBe('452') // from the weight line under it
    expect((review.getByLabelText('Bought on') as HTMLInputElement).value).toBe(BOUGHT) // read from the receipt
    expect(await db.pantryItems.count()).toBe(0)
    expect(engine.recognizeReceipt).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled() // nothing left the phone
  })

  it('leaves out store details, totals and payment lines', async () => {
    const review = await scan()
    for (const noise of [/subtotal/i, /visa/i, /extra store/i, /^TESCO$/]) expect(review.queryByText(noise)).toBeNull()
  })

  it('flags a food it only guessed, and leaves non-food unticked', async () => {
    const review = await scan()
    expect(review.getByText('Best guess, please check')).toBeTruthy() // semi skimmed milk is not exactly "whole milk"
    const roll = review.getByLabelText(/Add KITCHEN ROLL/) as HTMLInputElement
    expect(roll.checked).toBe(false)
    expect((review.getByLabelText(/Add BRITISH CHICKEN/) as HTMLInputElement).checked).toBe(true)
  })

  it('adds what you confirm to the pantry with the amount, place and use-by date, then says how many', async () => {
    const review = await scan()
    fireEvent.change(review.getByLabelText('Amount of Eggs'), { target: { value: '12' } })
    fireEvent.change(review.getByLabelText('Unit for Eggs'), { target: { value: 'piece' } })
    // no food found: it starts unticked, and stays out
    expect((review.getByLabelText(/Add ZZQX/) as HTMLInputElement).checked).toBe(false)
    fireEvent.click(review.getByRole('button', { name: /^Add \d+ items? to pantry$/ }))
    await waitFor(async () => expect(await db.pantryItems.count()).toBeGreaterThan(0))

    const items = await db.pantryItems.toArray()
    const chicken = await food('Chicken breast')
    const mine = items.find((i) => i.ingredientId === chicken.id)!
    expect(mine).toMatchObject({ qty: 500, unit: 'g', purchasedOn: BOUGHT, location: 'fridge' })
    expect(mine.expiresOn).toBe(addDays(BOUGHT, 3)) // chicken keeps 3 days in the fridge
    const eggsId = (await food('Eggs')).id
    const eggs = items.find((i) => i.ingredientId === eggsId)!
    expect(eggs).toMatchObject({ qty: 12, unit: 'piece' })
    expect(items.some((i) => i.ingredientId === undefined)).toBe(false)
    expect(items).toHaveLength(4) // chicken, milk, carrots, eggs; the unknown item and the kitchen roll stay out
    expect(await screen.findByText('Added 4 items from your receipt.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('will not add a ticked line that has no amount, and says which', async () => {
    const review = await scan()
    const add = review.getByRole('button', { name: /^Add \d+ items? to pantry$/ }) as HTMLButtonElement
    expect(add.disabled).toBe(true) // the eggs have no amount on the receipt
    expect(review.getByText(/needs a food and an amount/)).toBeTruthy()
    expect(review.getAllByText('Enter how much you bought.').length).toBeGreaterThan(0)
    fireEvent.change(review.getByLabelText('Amount of Eggs'), { target: { value: '12' } })
    fireEvent.change(review.getByLabelText('Unit for Eggs'), { target: { value: 'piece' } })
    await waitFor(() => expect(add.disabled).toBe(false))
  })

  it('lets you pick the right food when it found none, or the wrong one', async () => {
    const review = await scan()
    fireEvent.click(review.getByRole('button', { name: /Pick the food for ZZQX/ }))
    fireEvent.change(review.getByLabelText(/Search a food for ZZQX/), { target: { value: 'oats' } })
    fireEvent.click(await review.findByRole('button', { name: 'Rolled oats' }))
    expect((review.getByLabelText(/Add ZZQX/) as HTMLInputElement).checked).toBe(true) // choosing a food includes the line
    expect(review.getByText('Rolled oats')).toBeTruthy()

    fireEvent.click(review.getByRole('button', { name: /Change the food for SEMI SKIMMED MILK/ }))
    fireEvent.change(review.getByLabelText(/Search a food for SEMI SKIMMED MILK/), { target: { value: 'oat' } })
    fireEvent.click(await review.findByRole('button', { name: 'Rolled oats' }))
    expect(review.queryByText('Best guess, please check')).toBeNull() // you chose it, so it is no longer a guess
  })

  it('changing where it is kept moves its use-by date, and a date you type is kept', async () => {
    const review = await scan()
    const chicken = await food('Chicken breast')
    const where = review.getAllByLabelText('Keep it in')[0] as HTMLSelectElement
    expect(where.value).toBe('fridge')
    fireEvent.change(where, { target: { value: 'freezer' } })
    const expires = review.getAllByLabelText('Use by')[0] as HTMLInputElement
    expect(expires.value).toBe(addDays(BOUGHT, chicken.shelfLifeDays.freezer!))
    fireEvent.change(expires, { target: { value: addDays(BOUGHT, 2) } })
    fireEvent.change(review.getByLabelText('Amount of Eggs'), { target: { value: '12' } })
    fireEvent.change(review.getByLabelText('Unit for Eggs'), { target: { value: 'piece' } })
    fireEvent.click(review.getByRole('button', { name: /^Add \d+ items? to pantry$/ }))
    await waitFor(async () => expect(await db.pantryItems.count()).toBeGreaterThan(0))
    const mine = (await db.pantryItems.toArray()).find((i) => i.ingredientId === chicken.id)!
    expect(mine).toMatchObject({ location: 'freezer', expiresOn: addDays(BOUGHT, 2) })
  })

  it('says which items you were waiting for on the shopping list', async () => {
    const chicken = await food('Chicken breast')
    const id = (await db.recipes.add({
      title: 'Chicken dinner', servings: 1, servingsPerMeal: 1, ingredients: [{ ingredientId: chicken.id!, qty: 300, unit: 'g' }],
      steps: ['Cook it.'], estMinutes: 30, actualMinutesHistory: [],
    })) as number
    await db.mealPlan.add({ date: addDays(TODAY, 1), slot: 'dinner', recipeId: id, servingsPlanned: 1, status: 'planned' })
    const review = await scan()
    expect(review.getByText('On your shopping list')).toBeTruthy()
    expect(review.getAllByText('On your shopping list')).toHaveLength(1) // only the chicken
  })

  it('unticking a line leaves it out, and cancelling adds nothing at all', async () => {
    const review = await scan()
    fireEvent.click(review.getByLabelText(/Add BRITISH CHICKEN/))
    expect(review.queryByLabelText('Amount of Chicken breast')).toBeNull() // an unticked line has no details to fill in
    fireEvent.click(review.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await db.pantryItems.count()).toBe(0)
  })

  it('says so when nothing could be read, rather than adding rubbish', async () => {
    engine.recognizeReceipt.mockResolvedValue('~~ .. ##\n--')
    const review = await scan()
    expect(review.getByText(/No items could be read/)).toBeTruthy()
    expect((review.getByRole('button', { name: /^Add 0 items to pantry$/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('when reading goes wrong', () => {
  it('explains a failure and lets you try again', async () => {
    engine.recognizeReceipt.mockRejectedValueOnce(new Error('worker failed'))
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Scan a receipt/ }))
    fireEvent.change(await screen.findByLabelText('Receipt photo'), { target: { files: [photo()] } })
    expect(await screen.findByText(/could not be read/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Receipt photo'), { target: { files: [photo()] } })
    expect(await screen.findByRole('dialog', { name: 'Check your receipt' })).toBeTruthy()
  })

  it('shows progress while reading, and does not open the review if you have already left', async () => {
    let finish!: (text: string) => void
    engine.recognizeReceipt.mockImplementation((_f: File, onProgress: (n: number, l: string) => void) => {
      onProgress(0.4, 'Reading the receipt')
      return new Promise<string>((resolve) => (finish = resolve))
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Scan a receipt/ }))
    fireEvent.change(await screen.findByLabelText('Receipt photo'), { target: { files: [photo()] } })
    expect(await screen.findByText('Reading the receipt…')).toBeTruthy()
    expect((screen.getByLabelText('Reading progress') as HTMLProgressElement).value).toBeCloseTo(0.4)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    finish(RECEIPT) // the reading finishes after you left
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await db.pantryItems.count()).toBe(0)
  })

  it('can read a photo from your library as well as take one', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Scan a receipt/ }))
    fireEvent.change(await screen.findByLabelText('Receipt from your photos'), { target: { files: [photo()] } })
    expect(await screen.findByRole('dialog', { name: 'Check your receipt' })).toBeTruthy()
  })
})
