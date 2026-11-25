import { describe, expect, it } from 'vitest'
import seed from '../data/ingredients.seed.json'
import type { Ingredient } from '../types'
import { cleanName, findDate, parseReceipt } from './receipt'

const foods: Ingredient[] = (seed as Ingredient[]).map((i, n) => ({ ...i, id: n + 1 }))
const TODAY = '2026-11-19'
const read = (text: string) => parseReceipt(text, foods, TODAY)
const find = (r: ReturnType<typeof read>, re: RegExp) => r.lines.find((l) => re.test(l.text))

// What on-device OCR typically gives for a UK supermarket receipt: abbreviations, weighed produce on a second line, loyalty and payment lines.
const UK = `
TESCO
Extra Store 1234
Tel: 0345 456 7890
05/11/2026 17:42
BRITISH CHICKEN BREAST 500G   4.25 A
SEMI SKIMMED MILK 2L   1.55 A
ORG BANANAS 5PK 1.20
CARROTS LOOSE
0.452 kg @ £1.20/kg   0.54
BASMATI RICE 1KG  2.10
FREE RANGE EGGS 12  3.15
CARRIER BAG 5P    0.10
KITCHEN ROLL 2PK  1.80
Clubcard Price - Free Range Eggs   -0.50
SUBTOTAL  11.69
TOTAL  11.19
VISA CONTACTLESS  11.19
You earned 11 Clubcard points
Thank you for shopping with us
`

// A US receipt: pounds and ounces, department-style abbreviations, tax and tender lines.
const US = `
WALMART
Save money. Live better.
STORE 5260 (555) 123-4567
GV CHKN BRST BNLS 3.21 LB @ 2.99/LB 9.60 F
BANANAS
1.23 lb @ 0.59/lb 0.73
LG EGGS 18CT 4.98
PAPER TOWELS 8.97
SUBTOTAL 24.28
TAX 1 6.250% 0.00
TOTAL 24.28
DEBIT TEND 24.28
CHANGE DUE 0.00
# ITEMS SOLD 4
11/05/26 14:02
`

describe('reading a UK receipt', () => {
  const r = read(UK)

  it('finds the date', () => {
    expect(r.date).toBe('2026-11-05')
  })

  it('keeps the groceries and drops store details, totals, payment, loyalty and discount lines', () => {
    const names = r.lines.map((l) => l.text)
    expect(names).toEqual(expect.arrayContaining([expect.stringMatching(/chicken breast/), expect.stringMatching(/milk/), expect.stringMatching(/banana/), expect.stringMatching(/carrot/), expect.stringMatching(/rice/), expect.stringMatching(/egg/)]))
    for (const l of r.lines) expect(l.raw, l.raw).not.toMatch(/subtotal|total|visa|clubcard|thank|tel:|tesco|store/i)
    expect(r.lines.every((l) => (l.price ?? 0) >= 0)).toBe(true) // the -0.50 discount is gone
  })

  it('reads pack sizes as amounts', () => {
    expect(find(r, /chicken/)!.amount).toEqual({ qty: 500, unit: 'g' })
    expect(find(r, /milk/)!.amount).toEqual({ qty: 2000, unit: 'ml' })
    expect(find(r, /rice/)!.amount).toEqual({ qty: 1000, unit: 'g' })
  })

  it('takes the weight of weighed produce from the line below it, and its price', () => {
    const carrots = find(r, /carrot/)!
    expect(carrots.amount).toEqual({ qty: 452, unit: 'g' })
    expect(carrots.price).toBe(0.54)
  })

  it('matches foods, and says which matches are only a guess', () => {
    expect(find(r, /chicken/)!.match?.name).toBe('Chicken breast')
    expect(find(r, /carrot/)!.match?.name).toBe('Carrot')
    expect(find(r, /banana/)!.match?.name).toBe('Banana')
    expect(find(r, /egg/)!.match?.name).toBe('Eggs')
    expect(find(r, /rice/)!.match).not.toBeNull()
    expect(find(r, /milk/)!.match?.name).toBe('Whole milk')
    expect(find(r, /milk/)!.guess).toBe(true) // 'semi skimmed' is not the same as 'whole': worth a look
    expect(find(r, /carrot/)!.guess).toBe(false)
  })

  it('tidies the name when it drops a pack size', () => {
    expect(find(r, /banana/)!.text).toBe('organic bananas')
    expect(find(r, /egg/)!.text).toBe('free range eggs')
  })

  it('reads a pack of five as five pieces when there is no weight', () => {
    expect(find(r, /banana/)!.amount).toEqual({ qty: 5, unit: 'piece' })
  })

  it('drops the carrier bag charge, but keeps other things that are not food, unticked, so nothing disappears silently', () => {
    expect(r.lines.some((l) => /bag/.test(l.text))).toBe(false)
    const roll = r.lines.find((l) => /kitchen roll/.test(l.text))!
    expect(roll.isFood).toBe(false)
    expect(roll.match).toBeNull()
  })
})

describe('reading a US receipt', () => {
  const r = read(US)

  it('reads pounds as grams, and the weight line below an item', () => {
    expect(find(r, /chicken/)!.amount!.unit).toBe('g')
    expect(find(r, /chicken/)!.amount!.qty).toBeCloseTo(3.21 * 453.6, -1)
    expect(find(r, /banana/)!.amount!.qty).toBeCloseTo(1.23 * 453.6, -1)
    expect(find(r, /banana/)!.price).toBe(0.73)
  })

  it('expands till abbreviations and drops store-brand and tax noise', () => {
    expect(find(r, /chicken/)!.text).toBe('chicken breast boneless')
    expect(find(r, /chicken/)!.match?.name).toBe('Chicken breast')
    expect(r.lines.some((l) => /tax|tend|change|items sold/i.test(l.raw))).toBe(false)
  })

  it('marks paper towels as not food', () => {
    expect(r.lines.find((l) => /towel/.test(l.text))!.isFood).toBe(false)
  })

  it('reads 11/05/26 as the more recent real date, 5 November rather than 11 May', () => {
    expect(r.date).toBe('2026-11-05')
  })
})

describe('dates', () => {
  it('reads the common layouts', () => {
    expect(findDate('Date: 2026-11-12 10:00', TODAY)).toBe('2026-11-12')
    expect(findDate('12 Nov 2026', TODAY)).toBe('2026-11-12')
    expect(findDate('12 November 26', TODAY)).toBe('2026-11-12')
    expect(findDate('25/10/2026', TODAY)).toBe('2026-10-25') // only day first is a real date
    expect(findDate('10/25/2026', TODAY)).toBe('2026-10-25') // only month first is a real date
  })

  it('ignores a date in the future or more than a year old, which is a misread', () => {
    expect(findDate('30/12/2026', TODAY)).toBeUndefined()
    expect(findDate('01/01/2020', TODAY)).toBeUndefined()
    expect(findDate('31/02/2026', TODAY)).toBeUndefined() // not a real day
    expect(findDate('no date here', TODAY)).toBeUndefined()
  })

  it('a time is not a date', () => {
    expect(findDate('17:42:10', TODAY)).toBeUndefined()
  })
})

describe('tidying an item name', () => {
  it('removes codes, prices, pack sizes and store brands, and expands abbreviations', () => {
    expect(cleanName('5000169123456 TESCO ORG CHKN THGHS 650G £3.40 A')).toBe('organic chicken thighs')
    expect(cleanName('2 x GRND BF 500G 3.99')).toBe('ground beef')
    expect(cleanName('FRZ PEAS 1KG 1.50')).toBe('frozen peas')
  })
})

describe('what is not an item', () => {
  it('skips headings, slogans and lines with only a total or payment', () => {
    const r = read(`GROCERY\nPRODUCE\nThanks for shopping!\nBALANCE DUE 9.99\nCASH 10.00\nCHANGE 0.01\nBANANAS 1.20`)
    expect(r.lines.map((l) => l.text)).toEqual(['bananas'])
  })

  it('skips a discount line even when it has no loyalty or offer wording', () => {
    const r = read(['BAKED BEANS 4PK  2.40', 'BUY ONE GET ONE  -0.80', 'MILK 1.10'].join('\n'))
    expect(r.lines.map((l) => l.text)).toEqual(['baked beans', 'milk'])
  })

  it('returns nothing for text with no items, rather than inventing some', () => {
    expect(read('').lines).toEqual([])
    expect(read('???\n--\n.').lines).toEqual([])
  })

  it('leaves an unknown item with no food, so you pick one', () => {
    const r = read('ZZQX GLORP 2.50')
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].isFood).toBe(true)
    expect(r.lines[0].match).toBeNull()
  })
})

// A Canadian (Metro) receipt photo, exactly as the on-device reader read it: section headings, a saving line, loyalty points,
// a survey code, and the date twice, once year first on the card slip ("26/11/25") and once month first ("11/25/2026").
const METRO = `
Store #100704 (416)236-3217
EgoE        HST# 105216170

Moi Rewards program

Moi Rewards card number:380250293

GROCERY

DECECCO FUSILLI                     2.99

saving 0.50

BRAVO TOMATO PAS                    5.99
uERT

30 HOT ITAL.SAUS                    8.99
PRODUCE

ONION RED MEDIUM                    5.99
DELI crEESE

IRRS.PARMIGIA.RE                   13.99
SUBTOTAL           37.95
TOTAL           37.95

CREDIT CR                        37.95

Total number of items sold =     s

wewsvs Your savings today rrr

Promotional discounts                 0.50
Total of your savings                 0.50
Points                              12
Bonus points                             0
New earned points                                          12
NEW POINTS BALANCE                     265

How did we do? Tell us at
METROSURVEY.CA for a chance to win
$1000 IN FREE GROCERIES. Monthly winners

Your code
351800070M32393P03AM18D1

Trans. Type: PURCHASE

Account: VISA                 caps 37.95
Card Type: CREDIT

Card Number:     Hdd 5905 PB
DateTime:        26/11/25 12:08:46

Ref. #:          144715

Auth #:          05427F

Visa CREDIT
0000000031010 0000000000
00 APPROVED - THANK YOU
Keep this copy for your records

#%% CUSTOMER COBY *++

11/25/2026                        12:08 BM
999               100704 93 3837
`

describe('a Metro receipt', () => {
  const r = parseReceipt(METRO, foods, '2026-11-25')

  it('finds the five groceries and nothing else', () => {
    expect(r.lines.map((l) => [l.match?.name, l.price])).toEqual([
      ['Wheat pasta', 2.99],
      ['Tomato sauce', 5.99],
      ['Pork sausages', 8.99],
      ['Onion', 5.99],
      ['Parmesan', 13.99],
    ])
    expect(r.lines.every((l) => l.isFood)).toBe(true)
  })

  it('reads the date as 25 November 2026, not 26 November 2025', () => {
    expect(r.date).toBe('2026-11-25')
    expect(findDate('DateTime: 26/11/25 12:08:46', '2026-11-25')).toBe('2026-11-25')
  })

  it('reads "TOMATO PAS" as pasta sauce', () => {
    expect(r.lines[1].text).toBe('bravo tomato pasta sauce')
    expect(r.lines[1].guess).toBe(false)
  })
})

describe('lines that are not groceries', () => {
  it('skips plural discount and tax lines, prize slogans, codes and dividers', () => {
    const text = ['Promotional discounts 0.50', 'E&OE HST# R105216170', '$1000 IN FREE GROCERIES. Monthly winners', '3B1800070M32393P03AM18D1', '.........', 'Ref. #: 144715']
    expect(read(text.join('\n')).lines).toEqual([])
  })

  it('still keeps an item with an amount but no price', () => {
    expect(read('SEMI SKIMMED MILK 2L').lines.map((l) => l.amount)).toEqual([{ qty: 2000, unit: 'ml' }])
  })
})
