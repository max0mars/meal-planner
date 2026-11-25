import type { Ingredient, Unit } from '../types'
import { addDays } from './expiry'
import { searchIngredients } from './pantry'
import { parseIngredientLine } from './parseIngredients'

// Turns the text read from a till receipt into groceries to review. The text comes from on-device OCR, which misreads
// things, so everything here is a suggestion: the review screen is where you confirm what goes into the pantry.

export interface ReceiptLine {
  /** The line as read. */
  raw: string
  /** The item with codes, prices and abbreviations tidied up. */
  text: string
  price?: number
  /** How much of it, in a unit the pantry understands, when the receipt says. */
  amount?: { qty: number; unit: Unit }
  /** The food it looks like, if any. */
  match: Ingredient | null
  /** True when the food was found by a looser search, so it deserves a second look. */
  guess: boolean
  /** False for things that are not food (kitchen roll, cleaning products). They start unticked. */
  isFood: boolean
}

export interface ParsedReceipt {
  /** The purchase date, when the receipt shows one that makes sense (YYYY-MM-DD). */
  date?: string
  lines: ReceiptLine[]
}

const ABBREVIATIONS: Record<string, string> = {
  chkn: 'chicken', chk: 'chicken', ckn: 'chicken', brst: 'breast', brsts: 'breast', bnls: 'boneless', sknls: 'skinless', grnd: 'ground', gr: 'ground',
  org: 'organic', whl: 'whole', mlk: 'milk', skim: 'skimmed', frz: 'frozen', frzn: 'frozen', veg: 'vegetable', pto: 'potato', ptos: 'potatoes',
  tom: 'tomato', toms: 'tomatoes', bns: 'beans', brd: 'bread', chs: 'cheese', chse: 'cheese', ygt: 'yogurt', yog: 'yogurt', yogh: 'yogurt',
  btr: 'butter', bnna: 'banana', bnnas: 'bananas', ban: 'banana', apl: 'apple', apls: 'apples', orng: 'orange', lttc: 'lettuce', crt: 'carrot',
  crts: 'carrots', onn: 'onion', onns: 'onions', spnch: 'spinach', slmn: 'salmon', bf: 'beef', prk: 'pork', sausg: 'sausage', saus: 'sausage',
  mshrm: 'mushroom', mshrms: 'mushrooms', cucmbr: 'cucumber', brocc: 'broccoli', rce: 'rice', flr: 'flour', sgr: 'sugar', smkd: 'smoked',
  thgh: 'thigh', thghs: 'thighs', drmstk: 'drumstick', bcn: 'bacon', ital: 'italian',
  // "BRAVO TOMATO PAS": a jar of pasta sauce, cut short to fit the till line
  pas: 'pasta sauce',
  // size and brand codes that say nothing about the food
  gv: '', gfs: '', lg: '', sm: '', med: '',
}

/** Things that are on a receipt but are not an item at all: totals, payment, tax, loyalty, discounts, store details. */
const NOT_AN_ITEM = /\b(sub\s*total|total|balance|change|amount due|tax|vat|visa|mastercard|master card|amex|debit|credit|card|cash|tender|payment|paid|auth|approval|terminal|merchant|receipt|thank|welcome|store|tel|phone|www|http|points?|clubcard|nectar|loyalty|reward|savings?|saved|items? sold|number of items|no\.? of items|cashier|operator|trans(?:action)?|invoice|order|customer|survey|feedback|barcode|visit|please|come again|opening|hours|reg|rounding|round|deposit|carrier bag|bag charge|discount|coupon|voucher|promo(?:tion)?(?:al)?|multibuy|offer|club price|member|price|hst|gst|pst|qst|datetime|ref|code|winners?|chance)s?\b/i
/** Real items that are not food. They stay in the list, unticked, so nothing is silently lost. */
const NON_FOOD = /\b(bag|bin|liner|foil|cling|film|toilet|tissue|towel|detergent|washing|soap|shampoo|conditioner|toothpaste|toothbrush|razor|batter(?:y|ies)|bulb|candle|charcoal|nappy|nappies|wipe|bleach|cleaner|sponge|dishwasher|softener|deodorant|lotion|magazine|newspaper|stamp|lighter|matches|kitchen roll|pet food|cat food|dog food)s?\b/i

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * The purchase date: "05/11/2026", "5-11-26", "2026-11-05", "26/11/25" (year first, as card terminals print it), "05 Nov 2026".
 * A receipt can show the date more than once and in different orders (the till's and the card terminal's), and 05/11 could
 * be 5 November or 11 May, so every reading of every date is tried and the most recent real one wins.
 */
export function findDate(text: string, today: string): string | undefined {
  const valid = (y: number, m: number, d: number) => {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    const check = new Date(`${iso}T00:00:00Z`)
    if (check.getUTCFullYear() !== y || check.getUTCMonth() + 1 !== m || check.getUTCDate() !== d) return undefined
    // a purchase date is not in the future, and not more than a year back (that is a misread)
    return iso <= today && iso >= addDays(today, -366) ? iso : undefined
  }
  const year = (y: number) => (y < 100 ? 2000 + y : y)
  const found: (string | undefined)[] = []
  for (const m of text.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) found.push(valid(+m[1], +m[2], +m[3]))
  for (const m of text.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/g)) {
    const [a, b, c] = [+m[1], +m[2], +m[3]]
    // day first or month first; with a two-digit year at both ends, year first too (26/11/25 is 25 November 2026)
    found.push(valid(year(c), b, a), valid(year(c), a, b))
    if (m[3].length === 2) found.push(valid(year(a), b, c))
  }
  for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{2}|\d{4})\b/g)) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1
    if (month > 0) found.push(valid(year(+m[3]), month, +m[1]))
  }
  return found.filter((d): d is string => !!d).sort().at(-1)
}

const PRICE_AT_END = /(?:^|\s)[£$€]?\s?(-?\d{1,4}[.,]\d{2})\s?(?:[A-Za-z*]{1,2})?\s*$/
const WEIGHT = /(\d+(?:[.,]\d+)?)\s*(kg|g|lb|lbs|oz|ml|cl|l|ltr|litre|litres)\b/i
const RATE = /@\s*[£$€]?\s?\d+(?:[.,]\d+)?\s*\/\s*(?:kg|lb|lbs|g|oz)/i
const PACK = /\b(\d+)\s?(?:pk|pack|ct|count)\b/i

function toAmount(qty: number, unit: string): ReceiptLine['amount'] {
  const u = unit.toLowerCase()
  if (u === 'kg') return { qty: Math.round(qty * 1000), unit: 'g' }
  if (u === 'g') return { qty: Math.round(qty), unit: 'g' }
  if (u === 'lb' || u === 'lbs') return { qty: Math.round(qty * 453.6), unit: 'g' }
  if (u === 'oz') return { qty: Math.round(qty * 28.35), unit: 'g' }
  if (u === 'l' || u === 'ltr' || u === 'litre' || u === 'litres') return { qty: Math.round(qty * 1000), unit: 'ml' }
  if (u === 'cl') return { qty: Math.round(qty * 10), unit: 'ml' }
  return { qty: Math.round(qty), unit: 'ml' }
}

const num = (s: string) => Number(s.replace(',', '.'))

/** A line that only carries detail for the item above it: "0.452 kg @ £1.20/kg   £0.54", "2 x 0.85". */
function detailOnly(line: string): boolean {
  if (!/\d/.test(line)) return false // a row of dots or dashes is a divider, not a weight
  const withoutNumbers = line.replace(/[\d.,£$€@/xX*\s-]|kg|lbs?|oz|g\b|ml|cl|qty|each|ea|for/gi, '')
  return withoutNumbers.length === 0 || (RATE.test(line) && !/[A-Za-z]{4,}/.test(line.replace(RATE, '').replace(WEIGHT, '')))
}

function expand(words: string[]): string[] {
  return words.map((w) => (w in ABBREVIATIONS ? ABBREVIATIONS[w] : w)).filter(Boolean)
}

/** The item's name from a till line: price, codes, pack sizes and abbreviations taken away. */
export function cleanName(line: string): string {
  let s = line
    .replace(PRICE_AT_END, ' ')
    .replace(RATE, ' ')
    .replace(/\b\d{4,}\b/g, ' ') // product and PLU codes
    .replace(/^\s*(\d+)\s*[xX@]\s*/, ' ') // "2 x"
    .replace(/\s[xX]\s?\d+\b/g, ' ') // "x2"
    .replace(PACK, ' ')
    .replace(WEIGHT, ' ')
    .replace(/[£$€*#@]/g, ' ')
    .replace(/[^A-Za-z&' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  s = expand(s.split(' ')).join(' ')
  return s
    .replace(/\b(tesco|asda|sainsbury'?s?|morrisons|waitrose|aldi|lidl|co-?op|walmart|kroger|safeway|great value|own brand|finest|taste the difference|essential|everyday|value|simply|market|loose|prepacked|pre-packed)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The most likely food for a cleaned item name. The recipe matcher first; then a looser search that drops words from the
 * front ("semi skimmed milk", then "skimmed milk", then "milk"), which is marked as a guess so it gets a second look.
 */
function findFood(name: string, foods: Ingredient[]): { match: Ingredient | null; guess: boolean } {
  if (!name) return { match: null, guess: false }
  const strict = parseIngredientLine(name, foods).match
  if (strict) return { match: strict, guess: false }
  const words = name.split(' ')
  // every run of words, longest first: "carrots loose" gives "carrots", "semi skimmed milk" gives "skimmed milk" then "milk"
  for (let len = words.length; len >= 1; len--) {
    for (let start = 0; start + len <= words.length; start++) {
      const phrase = words.slice(start, start + len).join(' ')
      if (len < words.length && phrase.replace(/ /g, '').length < 4) continue // a short fragment would match nearly anything
      const loose = searchIngredients(foods, phrase, 1)[0]
      if (loose) return { match: loose, guess: true }
    }
  }
  return { match: null, guess: false }
}

/**
 * Reads the items from receipt text. Skips totals, payment, tax, loyalty and discount lines; joins a weight or quantity line
 * to the item above it; and keeps non-food items (kitchen roll, cleaning products) in the list, unticked.
 */
export function parseReceipt(text: string, foods: Ingredient[], today: string): ParsedReceipt {
  const rows = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const lines: ReceiptLine[] = []

  const date = findDate(text, today)

  rows.forEach((row, i) => {
    if (!/[A-Za-z0-9]/.test(row)) return

    // weight / quantity / price detail for the item just above
    if (lines.length > 0 && detailOnly(row)) {
      const last = lines[lines.length - 1]
      const w = WEIGHT.exec(row)
      if (w && !last.amount) last.amount = toAmount(num(w[1]), w[2])
      else if (!last.amount) {
        const q = /^(\d+)\s*[xX@]/.exec(row)
        if (q) last.amount = { qty: Number(q[1]), unit: 'piece' }
      }
      const p = PRICE_AT_END.exec(row)
      if (p && last.price == null) last.price = Math.abs(num(p[1]))
      return
    }

    const price = PRICE_AT_END.exec(row)
    const priced = price ? num(price[1]) : undefined
    const letters = row.replace(/[^A-Za-z]/g, '')
    if (letters.length < 3 || NOT_AN_ITEM.test(row) || (priced != null && priced < 0)) return
    // A line with no price and no amount is a heading, a slogan or a code ("HST# 105216170", "Ref. #: 144715"), unless the
    // next line is its weight and price ("CARROTS LOOSE" then "0.45 kg @ 1.20/kg 0.54").
    const detailFollows = rows[i + 1] != null && detailOnly(rows[i + 1])
    const hasAmount = WEIGHT.test(row) || PACK.test(row) || /^\d+\s*[xX@]\s/.test(row)
    if (priced == null && !hasAmount && !detailFollows) return

    const name = cleanName(row)
    // a code such as "3B1800070M32393P03AM18D1" leaves only scraps of letters, with no word in it
    if (name.length < 3 || !name.split(' ').some((w) => w.replace(/[^a-z]/g, '').length >= 3)) return

    let amount: ReceiptLine['amount']
    const w = WEIGHT.exec(row)
    const pack = PACK.exec(row)
    if (w) amount = toAmount(num(w[1]), w[2])
    else if (pack) amount = { qty: Number(pack[1]), unit: 'piece' }
    else {
      const q = /^(\d+)\s*[xX@]\s/.exec(row)
      if (q) amount = { qty: Number(q[1]), unit: 'piece' }
    }
    const nonFood = NON_FOOD.test(name)
    const { match, guess } = nonFood ? { match: null, guess: false } : findFood(name, foods)
    lines.push({ raw: row, text: name, price: priced, amount, match, guess, isFood: !nonFood })
  })
  return { date, lines }
}
