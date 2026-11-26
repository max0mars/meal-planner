import '../test/fakeServer'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { db } from '../db'
import { draftFromProduct, hasValidCheckDigit, lookupBarcode, normalizeBarcode, parsePackage, parseProduct, productNotices } from './barcode'
import { buildIngredient, checkDraft } from './customFood'
import { seedIfEmpty } from './seed'

describe('barcode numbers', () => {
  it('accepts real barcodes of each kind and rejects a wrong check digit', () => {
    expect(hasValidCheckDigit('5449000000996')).toBe(true) // EAN-13
    expect(hasValidCheckDigit('4006381333931')).toBe(true)
    expect(hasValidCheckDigit('036000291452')).toBe(true) // UPC-A
    expect(hasValidCheckDigit('96385074')).toBe(true) // EAN-8
    expect(hasValidCheckDigit('5449000000995')).toBe(false)
    expect(hasValidCheckDigit('544900000099')).toBe(false) // wrong length
    expect(hasValidCheckDigit('abc')).toBe(false)
  })

  it('gives every product one form: UPC-A gets a leading 0, so the same product is found either way', () => {
    expect(normalizeBarcode('036000291452')).toBe('0036000291452')
    expect(normalizeBarcode('0036000291452')).toBe('0036000291452')
    expect(normalizeBarcode('00036000291452')).toBe('0036000291452') // GTIN-14
    expect(normalizeBarcode('5449 0000 00996')).toBe('5449000000996') // spaces from typing
    expect(normalizeBarcode('96385074')).toBe('96385074')
  })

  it('expands a short UPC-E barcode to the full number', () => {
    expect(normalizeBarcode('04252614')).toBe('0042100005264') // UPC-A 042100005264
  })

  it('refuses misreads and mistyped digits', () => {
    expect(normalizeBarcode('5449000000995')).toBeNull()
    expect(normalizeBarcode('12345')).toBeNull()
    expect(normalizeBarcode('')).toBeNull()
    expect(normalizeBarcode('10000000000000')).toBeNull() // 14 digits not starting with 0
  })
})

const milkJson = {
  status: 1,
  product: {
    product_name: 'Semi Skimmed Milk',
    brands: 'Cravendale, Arla',
    quantity: '2 L',
    nutriments: { 'energy-kcal_100g': 47, proteins_100g: 3.6 },
    allergens_tags: ['en:milk'],
    traces_tags: ['en:soybeans', 'en:milk'],
    categories_tags: ['en:dairies', 'en:milks'],
  },
}

describe('reading an Open Food Facts product', () => {
  it('maps name, calories, protein, allergens, pack size and kind of food', () => {
    expect(parseProduct(milkJson, '5000000000000')).toEqual({
      barcode: '5000000000000',
      name: 'Semi Skimmed Milk',
      brand: 'Cravendale',
      kcalPer100g: 47,
      proteinPer100g: 3.6,
      tags: ['dairy', 'lactose'],
      maybeTags: ['soy'], // milk is already declared, so it is not repeated as a trace
      category: 'dairy-eggs',
      package: { qty: 2000, unit: 'ml' },
    })
  })

  it('works calories out from kilojoules when there is no kcal figure', () => {
    const p = parseProduct({ status: 1, product: { product_name: 'Oat bar', nutriments: { 'energy-kj_100g': 1674, proteins_100g: '7' } } }, '1')!
    expect(p.kcalPer100g).toBe(400)
    expect(p.proteinPer100g).toBe(7)
    expect(parseProduct({ status: 1, product: { product_name: 'x', nutriments: { energy_100g: 418 } } }, '1')!.kcalPer100g).toBe(100)
  })

  it('leaves a missing figure empty rather than guessing zero, and says so', () => {
    const p = parseProduct({ status: 1, product: { product_name: 'Mystery sauce', nutriments: { 'energy-kcal_100g': 120 } } }, '1')!
    expect(p.proteinPer100g).toBeUndefined()
    expect(draftFromProduct(p).protein).toBe('')
    expect(productNotices(p).join(' ')).toMatch(/no protein figure/)
    const none = parseProduct({ status: 1, product: { product_name: 'Nothing' } }, '1')!
    expect(productNotices(none).join(' ')).toMatch(/no calories/)
    expect(draftFromProduct(none).kcal).toBe('')
  })

  it('maps every declared allergen to the categories this app uses', () => {
    const tags = (allergens_tags: string[]) => parseProduct({ status: 1, product: { product_name: 'x', allergens_tags } }, '1')!.tags
    expect(tags(['en:gluten'])).toEqual(['gluten'])
    expect(tags(['en:eggs'])).toEqual(['egg'])
    expect(tags(['en:soybeans'])).toEqual(['soy'])
    expect(tags(['en:peanuts'])).toEqual(['peanut'])
    expect(tags(['en:nuts'])).toEqual(['tree-nut'])
    expect(tags(['en:sesame-seeds'])).toEqual(['sesame'])
    expect(tags(['en:fish'])).toEqual(['fish'])
    expect(tags(['en:crustaceans', 'en:molluscs'])).toEqual(['shellfish'])
    expect(tags(['en:celery', 'en:mustard'])).toEqual([]) // not categories this app tracks
  })

  it('returns null for products with no name, and for "not found"', () => {
    expect(parseProduct({ status: 0 }, '1')).toBeNull()
    expect(parseProduct({ status: 1, product: { product_name: '  ' } }, '1')).toBeNull()
    expect(parseProduct(null, '1')).toBeNull()
  })

  it('reads pack sizes, and does not guess at multipacks', () => {
    expect(parsePackage('400 g')).toEqual({ qty: 400, unit: 'g' })
    expect(parsePackage('1.5 kg')).toEqual({ qty: 1500, unit: 'g' })
    expect(parsePackage('1,5 L')).toEqual({ qty: 1500, unit: 'ml' })
    expect(parsePackage('75cl')).toEqual({ qty: 750, unit: 'ml' })
    expect(parsePackage('330 ml')).toEqual({ qty: 330, unit: 'ml' })
    expect(parsePackage('6 x 330 ml')).toBeUndefined()
    expect(parsePackage('12 slices')).toBeUndefined()
    expect(parsePackage(undefined)).toBeUndefined()
  })

  it('fills in the add-a-food form, attaches the barcode, and suggests traces without ticking them', () => {
    const p = parseProduct(milkJson, '5000000000000')!
    const d = draftFromProduct(p)
    expect(d).toMatchObject({ name: 'Semi Skimmed Milk', kcal: '47', protein: '3.6', category: 'dairy-eggs', barcode: '5000000000000', aliases: 'cravendale' })
    expect(d.tags).toEqual(['dairy', 'lactose'])
    expect(d.tags).not.toContain('soy')
    expect(productNotices(p).join(' ')).toMatch(/traces/)
    expect(Number(d.shelf.fridge)).toBeGreaterThan(0)
  })

  it('a saved food keeps the barcode, and the same barcode cannot be given to two foods', () => {
    const d = draftFromProduct(parseProduct(milkJson, '5000000000000')!)
    expect(checkDraft(d, []).errors).toEqual({})
    expect(buildIngredient(d).barcode).toBe('5000000000000')
    const other = { ...buildIngredient(d), id: 9 }
    expect(checkDraft({ ...d, name: 'Another milk' }, [other]).errors.name).toMatch(/already belongs/)
    expect(checkDraft(d, [other], 9).errors).toEqual({}) // editing the food itself is fine
  })
})

describe('looking a barcode up', () => {
  beforeAll(async () => {
    await seedIfEmpty()
  })
  const ok = (body: unknown, status = 200) => vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))

  it('finds one of your own foods first, without going online', async () => {
    const draft = { ...draftFromProduct(parseProduct(milkJson, '5000000000017')!), name: 'Scan test milk' }
    const id = (await db.ingredients.add(buildIngredient(draft))) as number
    const fetchImpl = vi.fn(async () => {
      throw new Error('should not be called')
    })
    const r = await lookupBarcode('5000000000017', { fetchImpl: fetchImpl as never })
    expect(r).toMatchObject({ kind: 'local', food: { id, name: 'Scan test milk' } })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('asks Open Food Facts with only the barcode number', async () => {
    const fetchImpl = ok(milkJson)
    const r = await lookupBarcode('5449000000996', { fetchImpl: fetchImpl as never })
    expect(r.kind).toBe('found')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toMatch(/^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/5449000000996\.json\?fields=[a-z_,]+$/)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(init?.body).toBeUndefined()
    expect(init?.headers).toBeUndefined() // no identifying headers
  })

  it('says unknown for a barcode the database has not got, and offline when it cannot be reached', async () => {
    expect((await lookupBarcode('5449000000996', { fetchImpl: ok({ status: 0 }) as never })).kind).toBe('unknown')
    expect((await lookupBarcode('5449000000996', { fetchImpl: ok({}, 404) as never })).kind).toBe('unknown')
    expect((await lookupBarcode('5449000000996', { fetchImpl: ok({}, 503) as never })).kind).toBe('offline')
    const broken = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    expect((await lookupBarcode('5449000000996', { fetchImpl: broken as never })).kind).toBe('offline')
  })

  it('gives up after the timeout instead of waiting forever', async () => {
    const hang = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
    )
    const r = await lookupBarcode('5449000000996', { fetchImpl: hang as never, timeoutMs: 20 })
    expect(r.kind).toBe('offline')
  })
})
