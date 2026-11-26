// @vitest-environment jsdom
import './test/fakeServer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import { API_URL } from './api/client'

import { DEFAULT_SETTINGS, db } from './db'
import { seedIfEmpty } from './lib/seed'
import { ScanError } from './lib/scanEngine'

// The test server's fetch, kept before the food-database mock replaces fetch.
const serverFetch = globalThis.fetch

// The Ingredients page draws every food (about 400, each with a sensitivity slider), which takes a few seconds in the test
// browser on a busy machine. Give these tests time to see it instead of failing on the default 1 s wait and 5 s limit.
configure({ asyncUtilTimeout: 5000 })
vi.setConfig({ testTimeout: 20000 })

// jsdom has no camera, so the camera module is replaced. Everything else (lookup, forms, saving) is the real code.
const engine = vi.hoisted(() => ({
  onCode: null as ((raw: string) => void) | null,
  stop: vi.fn(),
  startScan: vi.fn(),
  decodeImage: vi.fn(),
}))
vi.mock('./lib/scanEngine', async (original) => {
  const real = await original<typeof import('./lib/scanEngine')>()
  return { ...real, startScan: engine.startScan, decodeImage: engine.decodeImage }
})

const MILK = '5449000000996'
const BEANS = '4006381333931'
const productJson = (over: Record<string, unknown> = {}) => ({
  status: 1,
  product: {
    product_name: 'Semi Skimmed Milk',
    brands: 'Cravendale',
    quantity: '2 L',
    nutriments: { 'energy-kcal_100g': 47, proteins_100g: 3.6 },
    allergens_tags: ['en:milk'],
    traces_tags: ['en:soybeans'],
    categories_tags: ['en:milks'],
    ...over,
  },
})
const respond = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status })
const fetchMock = vi.fn()

beforeAll(async () => {
  await seedIfEmpty()
})
beforeEach(() => {
  engine.onCode = null
  engine.stop.mockReset()
  engine.decodeImage.mockReset()
  engine.startScan.mockReset().mockImplementation(async (_video: unknown, onCode: (raw: string) => void) => {
    engine.onCode = onCode
    return { stop: engine.stop, torchSupported: false, setTorch: vi.fn() }
  })
  fetchMock.mockReset().mockImplementation(respond(productJson()))
  // Only the food-database lookups are mocked; the planner's own requests still go to the test server.
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith(API_URL) ? serverFetch(input, init) : fetchMock(input, init),
  )
})
afterEach(async () => {
  cleanup()
  vi.unstubAllGlobals()
  await db.ingredients.where('custom').equals(1 as never).delete().catch(() => {})
  for (const f of await db.ingredients.toArray()) if (f.custom) await db.ingredients.delete(f.id!)
  await db.pantryItems.clear()
  await db.settings.put({ ...DEFAULT_SETTINGS })
})

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
const customFoods = async () => (await db.ingredients.toArray()).filter((f) => f.custom)
const scan = async (code: string) => {
  await waitFor(() => expect(engine.onCode).not.toBeNull())
  engine.onCode!(code)
}

describe('scanning to add a food', () => {
  it('fills the form from the product but saves nothing until you do, and then remembers the barcode', async () => {
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    await scan(MILK)

    const name = (await screen.findByLabelText('Name')) as HTMLInputElement
    expect(name.value).toBe('Semi Skimmed Milk')
    expect((screen.getByLabelText('Calories (kcal)') as HTMLInputElement).value).toBe('47')
    expect((screen.getByLabelText('Protein (g)') as HTMLInputElement).value).toBe('3.6')
    expect(screen.getByRole('button', { name: 'Dairy', pressed: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Soy', pressed: false })).toBeTruthy() // a trace is suggested, not ticked
    expect(screen.getByText(/may contain traces/)).toBeTruthy()
    expect(engine.stop).toHaveBeenCalled() // the camera is off once a code is read
    expect(await customFoods()).toHaveLength(0) // nothing saved yet

    fireEvent.click(screen.getByRole('button', { name: 'Save food' }))
    await waitFor(async () => expect(await customFoods()).toHaveLength(1))
    expect((await customFoods())[0]).toMatchObject({ name: 'Semi Skimmed Milk', barcode: MILK, kcalPer100g: 47, proteinPer100g: 3.6, custom: true })
    expect((await customFoods())[0].tags).toEqual(expect.arrayContaining(['dairy', 'lactose']))
  })

  it('finds a barcode you saved before without going online, and opens that food', async () => {
    await db.ingredients.add({
      name: 'My oat drink', aliases: [], category: 'pantry', tags: ['oats'], shelfLifeDays: { pantry: 30 }, kcalPer100g: 40, proteinPer100g: 1, sensitivity: 'safe', custom: true, barcode: BEANS,
    })
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    await scan(BEANS)
    expect(await screen.findByRole('heading', { name: 'Edit food' })).toBeTruthy()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('My oat drink')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores a misread and keeps scanning', async () => {
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    await scan('1234567')
    await scan('5449000000995') // bad check digit
    expect(fetchMock).not.toHaveBeenCalled()
    expect(engine.stop).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Scan a barcode' })).toBeTruthy()
    await scan(MILK) // a good read goes through
    expect(await screen.findByLabelText('Name')).toBeTruthy()
  })

  it('only acts on the first read, even if the camera then sees the same or another barcode before it shuts', async () => {
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    await scan(MILK)
    engine.onCode!(MILK)
    engine.onCode!(BEANS) // a second product in frame must not switch the lookup
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('Semi Skimmed Milk')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain(MILK)
  })

  it('a barcode the database does not have opens a blank form with the barcode attached', async () => {
    fetchMock.mockImplementation(respond({ status: 0 }))
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    await scan(BEANS)
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('')
    expect(screen.getByText(/not in the food database/)).toBeTruthy()
    expect(screen.getByText(new RegExp(`Barcode ${BEANS}`))).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Baked beans' } })
    fireEvent.change(screen.getByLabelText('Calories (kcal)'), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText('Protein (g)'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save food' }))
    await waitFor(async () => expect((await customFoods())[0]?.barcode).toBe(BEANS))
  })

  it('a missing protein figure is flagged for you to fill in, not silently zero', async () => {
    fetchMock.mockImplementation(respond(productJson({ nutriments: { 'energy-kcal_100g': 120 } })))
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    await scan(MILK)
    expect(await screen.findByText(/no protein figure/)).toBeTruthy()
    expect((screen.getByLabelText('Protein (g)') as HTMLInputElement).value).toBe('')
  })

  it('says when it cannot reach the database, and lets you try again or fill it in yourself', async () => {
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch')
    })
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    await scan(MILK)
    expect(await screen.findByText(/Could not reach the food database/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('Semi Skimmed Milk')
  })

  it('offline: "Enter it by hand" opens a blank form that keeps the barcode', async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    await scan(MILK)
    fireEvent.click(await screen.findByRole('button', { name: 'Enter it by hand' }))
    expect(await screen.findByLabelText('Name')).toBeTruthy()
    expect(screen.getByText(new RegExp(`Barcode ${MILK}`))).toBeTruthy()
  })
})

describe('the camera', () => {
  it('switches off when you close the scanner', async () => {
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    await waitFor(() => expect(engine.onCode).not.toBeNull())
    await waitFor(() => expect(screen.queryByText('Starting the camera…')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Scan a barcode' })).toBeNull())
    expect(engine.stop).toHaveBeenCalled()
  })

  it('switches off even if the scanner is closed while the camera is still starting', async () => {
    let finish!: (scan: unknown) => void
    engine.startScan.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    await waitFor(() => expect(engine.startScan).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Scan a barcode' })).toBeNull())
    finish({ stop: engine.stop, torchSupported: false, setTorch: vi.fn() })
    await waitFor(() => expect(engine.stop).toHaveBeenCalled())
  })

  it.each([
    ['denied', /camera is blocked/],
    ['no-camera', /No camera was found/],
    ['insecure', /secure \(https\) address/],
    ['failed', /could not start/],
  ] as const)('explains a %s camera, and typing the number still works', async (kind, message) => {
    engine.startScan.mockRejectedValue(new ScanError(kind))
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    expect(await screen.findByText(message)).toBeTruthy()

    fireEvent.change(screen.getByLabelText(/type the number/i), { target: { value: '12345' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
    expect(await screen.findByText(/not a valid barcode number/)).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/type the number/i), { target: { value: '5449 0000 00996' } })
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }))
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('Semi Skimmed Milk')
  })

  it('reads a barcode from a photo, or says none could be read', async () => {
    engine.startScan.mockRejectedValue(new ScanError('denied'))
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Scan a barcode to add a food/ }))
    const photo = await screen.findByLabelText('Barcode photo')
    engine.decodeImage.mockResolvedValueOnce(null)
    fireEvent.change(photo, { target: { files: [new File(['x'], 'a.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByText(/No barcode could be read/)).toBeTruthy()
    engine.decodeImage.mockResolvedValueOnce(MILK)
    fireEvent.change(photo, { target: { files: [new File(['x'], 'b.jpg', { type: 'image/jpeg' })] } })
    expect(((await screen.findByLabelText('Name')) as HTMLInputElement).value).toBe('Semi Skimmed Milk')
  })
})

describe('scanning from the pantry and from the add-food sheet', () => {
  const pantryAdd = async () => {
    open('/pantry')
    fireEvent.click(await screen.findByRole('button', { name: /Add groceries/ }))
    return screen.findByRole('button', { name: /Scan a barcode/ })
  }

  it('a new product from the pantry: after you save it, the amount is the pack size on the label', async () => {
    fireEvent.click(await pantryAdd())
    await scan(MILK)
    await screen.findByLabelText('Name')
    fireEvent.click(screen.getByRole('button', { name: 'Save food' }))
    expect(await screen.findByText('Semi Skimmed Milk')).toBeTruthy()
    await waitFor(() => expect((screen.getByLabelText('How much?') as HTMLInputElement).value).toBe('2000'))
    expect((screen.getByLabelText('Unit') as HTMLSelectElement).value).toBe('ml')
  })

  it('a barcode you have scanned before goes straight to "how much?"', async () => {
    await db.ingredients.add({
      name: 'My oat drink', aliases: [], category: 'pantry', tags: ['oats'], shelfLifeDays: { pantry: 30 }, kcalPer100g: 40, proteinPer100g: 1, sensitivity: 'safe', custom: true, barcode: BEANS,
    })
    fireEvent.click(await pantryAdd())
    await scan(BEANS)
    expect(await screen.findByText('My oat drink')).toBeTruthy()
    expect(screen.getByLabelText('How much?')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('inside the add-food sheet, a scan of a barcode you already have offers that food instead of a copy', async () => {
    await db.ingredients.add({
      name: 'My oat drink', aliases: [], category: 'pantry', tags: ['oats'], shelfLifeDays: { pantry: 30 }, kcalPer100g: 40, proteinPer100g: 1, sensitivity: 'safe', custom: true, barcode: BEANS,
    })
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Add a food/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Fill in from a barcode/ }))
    await scan(BEANS)
    const sheet = await screen.findByRole('dialog', { name: 'Add a food' })
    expect(await within(sheet).findByText(/already have “My oat drink”/)).toBeTruthy()
  })

  it('inside the add-food sheet, a scan fills the form without leaving it', async () => {
    open('/ingredients')
    fireEvent.click(await screen.findByRole('button', { name: /Add a food/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Fill in from a barcode/ }))
    await scan(MILK)
    await waitFor(() => expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Semi Skimmed Milk'))
    expect(screen.getByRole('dialog', { name: 'Add a food' })).toBeTruthy()
  })
})
