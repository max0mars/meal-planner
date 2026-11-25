import type { Ingredient, Unit } from '../types'
import { searchIngredients } from './pantry'

export interface ParsedLine {
  /** The original line, trimmed. */
  source: string
  qty: number | null
  unit: Unit
  /** The ingredient name as written, cleaned up. */
  text: string
  /** Best guess from your foods, or null if nothing matched. */
  match: Ingredient | null
  /** True when the amount was worked out from a vague phrase like "a pinch" rather than read directly. */
  estimated: boolean
  /** Plain-language note for the user, such as how an amount was estimated. Empty when there is nothing to say. */
  note: string
}

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 }

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
}

/** Written unit -> [our unit, multiplier]. Weights and volumes are converted to g or ml. */
const UNITS: Record<string, [Unit, number]> = {
  g: ['g', 1], gram: ['g', 1], grams: ['g', 1], gm: ['g', 1],
  kg: ['g', 1000], kilogram: ['g', 1000], kilograms: ['g', 1000],
  oz: ['g', 28.35], ounce: ['g', 28.35], ounces: ['g', 28.35],
  lb: ['g', 453.6], lbs: ['g', 453.6], pound: ['g', 453.6], pounds: ['g', 453.6],
  ml: ['ml', 1], milliliter: ['ml', 1], milliliters: ['ml', 1], millilitre: ['ml', 1], millilitres: ['ml', 1],
  l: ['ml', 1000], liter: ['ml', 1000], liters: ['ml', 1000], litre: ['ml', 1000], litres: ['ml', 1000],
  tsp: ['tsp', 1], tsps: ['tsp', 1], tspn: ['tsp', 1], teaspoon: ['tsp', 1], teaspoons: ['tsp', 1],
  tbsp: ['tbsp', 1], tbs: ['tbsp', 1], tbls: ['tbsp', 1], tblsp: ['tbsp', 1], tbsps: ['tbsp', 1], tablespoon: ['tbsp', 1], tablespoons: ['tbsp', 1],
  cup: ['cup', 1], cups: ['cup', 1],
  qt: ['ml', 946], quart: ['ml', 946], quarts: ['ml', 946], pint: ['ml', 473], pints: ['ml', 473],
  clove: ['piece', 1], cloves: ['piece', 1], slice: ['piece', 1], slices: ['piece', 1],
  stalk: ['piece', 1], stalks: ['piece', 1], piece: ['piece', 1], pieces: ['piece', 1],
}

/** Vague measure words, mapped to a base form. Their size depends on the food, so they are estimated after matching. */
const VAGUE: Record<string, string> = {
  pinch: 'pinch', pinches: 'pinch', dash: 'dash', dashes: 'dash', splash: 'splash', splashes: 'splash',
  drizzle: 'drizzle', drizzles: 'drizzle', glug: 'glug', glugs: 'glug', knob: 'knob', knobs: 'knob',
  handful: 'handful', handfuls: 'handful', bunch: 'bunch', bunches: 'bunch', sprig: 'sprig', sprigs: 'sprig',
  sprinkle: 'sprinkle', squeeze: 'squeeze', bit: 'bit', touch: 'touch', drop: 'drop', drops: 'drop',
  spoonful: 'spoonful', spoonfuls: 'spoonful', scoop: 'scoop', scoops: 'scoop', can: 'can', cans: 'can', tin: 'can',
  tins: 'can', head: 'head', heads: 'head', stick: 'stick', sticks: 'stick',
  // Containers with no standard size: recognised so they are not mistaken for "1 piece", but never guessed.
  pack: 'pack', packs: 'pack', packet: 'pack', packets: 'pack', bag: 'pack', bags: 'pack', bottle: 'pack', bottles: 'pack',
  jar: 'pack', jars: 'pack', carton: 'pack', cartons: 'pack', tub: 'pack', tubs: 'pack', box: 'pack', boxes: 'pack',
}

/** Size words that scale a vague measure: "a small handful", "a generous pinch". */
const SIZE: Record<string, number> = {
  tiny: 0.25, small: 0.5, little: 0.5, medium: 1, large: 2, big: 2, generous: 1.5, good: 1.5, heaped: 1.5, heaping: 1.5, healthy: 1.5,
}

const NOISE = new Set([
  'chopped', 'diced', 'minced', 'sliced', 'grated', 'shredded', 'crushed', 'fresh', 'freshly', 'large', 'medium', 'small',
  'boneless', 'skinless', 'finely', 'roughly', 'thinly', 'optional', 'extra', 'virgin', 'ripe', 'of', 'a', 'an', 'the', 'some',
  'to', 'taste', 'and', 'or', 'about', 'heaping', 'level', 'packed', 'as', 'needed', 'for', 'serving', 'garnish',
  // describe the item, not which food it is
  'new', 'baby', 'unwaxed', 'organic', 'caster', 'granulated', 'sea', 'kosher', 'flaky', 'unsalted', 'salted', 'cleaned',
  'trimmed', 'peeled', 'halved', 'quartered', 'fillet', 'fillets', 'filet', 'filets',
  // words about how it is used, not which food it is
  'free-range', 'glaze', 'dusting', 'leaves', 'topping', 'shaved', 'crumbled', 'bowtie', 'rigate',
  // cooked state is handled separately, not part of the food's name
  'cooked', 'raw', 'uncooked', 'warm', 'cold', 'boiling', 'lukewarm', 'iced',
  // containers
  'jar', 'jars', 'packet', 'pack', 'bottle', 'bag', 'carton', 'tub', 'tube', 'pot',
])

/** Words too general to identify a food on their own: "black onion seeds" must not become "Chia seeds". */
const TOO_GENERIC = new Set([
  'seeds', 'seed', 'oil', 'sauce', 'powder', 'paste', 'milk', 'cheese', 'juice', 'stock', 'broth', 'cream', 'flour', 'nuts',
  'nut', 'beans', 'bread', 'pasta', 'noodles', 'salad', 'dressing', 'spice', 'spices', 'herbs', 'mix', 'wine',
  'vegetable', 'vegetables', 'veg', 'fish', 'water', 'extract', 'flakes', 'sprouts', 'coconut',
])

const TO_TASTE = /\b(to taste|as needed|if needed|for (?:serving|garnish|dusting|sprinkling))\b/i

/** "750g/1lb 10oz" or "2 cups/500ml": keep the first measure, drop the alternative. */
const ALTERNATE_MEASURE =
  /(\d)\s*(g|kg|ml|l|oz|lb|lbs|cups?|tbsp|tsp)\s*\/\s*\d[\d\s½¼¾./]*\s*(?:g|kg|ml|l|oz|lb|lbs|pints?|fl\s*oz|cups?|tbsp|tsp)\b(?:\s+\d+\s*oz)?/gi

/** "1 x 280g jar": a count of packs with a weight each. Returns the total. */
const PACK_COUNT = /^(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l|oz|lb)\b\s*/i

/** A weight in brackets, such as "(about 400g/14oz)": the per-item weight in grams. */
function bracketWeightGrams(text: string): number | null {
  const m = text.match(/\(\s*(?:about|approx\.?|approximately|around)?\s*(\d+(?:\.\d+)?)\s*(g|kg|oz|lb|lbs)\b/i)
  const unit = m ? UNITS[m[2].toLowerCase()] : undefined
  return m && unit ? Number(m[1]) * unit[1] : null
}

const isSalt = (i: Ingredient) => /^salt\b/i.test(i.name)

type Estimate = { qty: number; unit: Unit }

/** Typical amount for a vague measure, depending on the food. Returns null when no sensible guess exists. */
export function estimateVague(measure: string, ing: Ingredient): Estimate | null {
  const herbOrSpice = ing.category === 'spices-herbs' || isSalt(ing)
  switch (measure) {
    case 'pinch':
    case 'dash':
      return { qty: 0.25, unit: 'tsp' }
    case 'taste':
      return herbOrSpice ? { qty: 0.25, unit: 'tsp' } : null
    case 'little':
    case 'sprinkle':
    case 'squeeze':
    case 'bit':
    case 'touch':
    case 'drop':
      return herbOrSpice ? { qty: 0.25, unit: 'tsp' } : { qty: 1, unit: 'tsp' }
    case 'splash':
    case 'drizzle':
    case 'knob':
    case 'spoonful':
      return { qty: 1, unit: 'tbsp' }
    case 'glug':
      return { qty: 2, unit: 'tbsp' }
    case 'handful':
      return { qty: ing.category === 'spices-herbs' ? 10 : 30, unit: 'g' }
    case 'bunch': {
      if (ing.category === 'spices-herbs') return { qty: 30, unit: 'g' }
      const grams: Record<string, number> = { 'Green onion': 90, Radish: 150, Spinach: 200, Kale: 200, Arugula: 100 }
      if (grams[ing.name]) return { qty: grams[ing.name], unit: 'g' }
      return ing.category === 'produce' ? { qty: 150, unit: 'g' } : null
    }
    case 'sprig':
      return { qty: 2, unit: 'g' }
    case 'can': {
      const grams: Record<string, number> = { 'Canned tuna': 140, Sardines: 90, 'Tomato paste': 140 }
      return { qty: grams[ing.name] ?? 400, unit: 'g' }
    }
    case 'head': {
      const grams: Record<string, number> = { Garlic: 40, Broccoli: 300, Cauliflower: 600, Cabbage: 900, 'Romaine lettuce': 300 }
      return grams[ing.name] ? { qty: grams[ing.name], unit: 'g' } : null
    }
    case 'stick':
      if (ing.name === 'Celery') return { qty: 1, unit: 'piece' } // a stick of celery is one stalk
      return ing.name === 'Butter' ? { qty: 113, unit: 'g' } : null
    case 'scoop':
      return /protein powder/i.test(ing.name) ? { qty: 30, unit: 'g' } : null
    default:
      return null
  }
}

function singular(word: string): string {
  if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`
  if (word.endsWith('oes')) return word.slice(0, -2)
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function parseNumber(text: string): { value: number; rest: string } | null {
  const m = text.match(/^(\d+)?\s*([½¼¾⅓⅔⅛])|^(\d+)\s+(\d+)\/(\d+)|^(\d+)\/(\d+)|^(\d+(?:\.\d+)?)/)
  if (!m) return null
  let value: number
  if (m[2]) value = Number(m[1] ?? 0) + FRACTIONS[m[2]]
  else if (m[3]) value = Number(m[3]) + Number(m[4]) / Number(m[5])
  else if (m[6]) value = Number(m[6]) / Number(m[7])
  else value = Number(m[8])
  let rest = text.slice(m[0].length)
  // "1-2 cups": use the first number.
  rest = rest.replace(/^\s*(?:-|–|to)\s*\d+(?:\.\d+)?/, '')
  return { value, rest }
}

/** Does `q` occur in `text` as whole words (allowing a plural s/es), starting at the start of the text or of any word? */
function wholeWordsAt(text: string, q: string, onlyAtStart: boolean): boolean {
  for (let i = text.indexOf(q); i !== -1; i = text.indexOf(q, i + 1)) {
    const startsWord = i === 0 || /[\s(,/-]/.test(text[i - 1])
    if (!startsWord || (onlyAtStart && i !== 0)) continue
    const after = text.slice(i + q.length)
    if (after === '' || /^(?:s|es)?(?:[\s(,/).-]|$)/.test(after)) return true
  }
  return false
}

/**
 * Is `hit` really the food named by `candidate`? Accepts an exact name or alias, or the name starting with the
 * words ("chicken" for Chicken breast). A single word may also appear inside the name ("bass" in Sea bass).
 * Anything weaker is refused: an alias that merely begins with the words ("vegetable stock" vs "vegetable stock
 * cube"), or a word fragment ("ham" inside "hamburger"), is a different food.
 */
function isTheFood(hit: Ingredient, candidate: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/-/g, ' ')
  const c = norm(candidate)
  const name = norm(hit.name)
  if (name === c || hit.aliases.some((a) => norm(a) === c)) return true
  if (wholeWordsAt(name, c, true)) return true
  return !c.includes(' ') && wholeWordsAt(name, c, false)
}

interface FoodMatch {
  ingredient: Ingredient
  /** True when only the last word matched ("caster sugar" -> Sugar), so the user should check it. */
  loose: boolean
  /** The word that matched loosely. */
  word: string
  /** True when the food was picked from a "such as ..." list of options. */
  fromOptions?: boolean
}

/** Words that describe a variety or state without changing which food it is: "red onions", "ground cumin", "melted butter". */
const QUALIFIERS = new Set([
  'ground', 'dried', 'red', 'green', 'yellow', 'plum', 'cherry', 'beaten', 'melted', 'softened', 'tinned', 'canned', 'smoked', 'streaky', 'white',
  // apple and potato varieties, and cuts of nut
  'braeburn', 'bramley', 'gala', 'fuji', 'granny', 'smith', 'cox', 'floury', 'waxy', 'jersey', 'royal', 'maris', 'piper', 'flaked', 'slivered',
  'blanched', 'toasted',
])

function bestMatch(name: string, all: Ingredient[]): FoodMatch | null {
  const tokens = name.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null
  const last = tokens[tokens.length - 1]
  const plain = tokens.filter((t) => !QUALIFIERS.has(t))
  // A qualifier-free phrase is only useful if something specific is left ("beans" alone says nothing).
  const plainUseful = plain.length > 0 && plain.length < tokens.length && !(plain.length === 1 && TOO_GENERIC.has(plain[0]))
  // In order of confidence. Only the last-word-alone attempt is "loose".
  const attempts: { phrase: string; loose: boolean; droppedDried: boolean }[] = [
    { phrase: tokens.join(' '), loose: false, droppedDried: false },
    ...(plainUseful ? [{ phrase: plain.join(' '), loose: false, droppedDried: tokens.includes('dried') }] : []),
    { phrase: tokens.slice(-2).join(' '), loose: false, droppedDried: false },
    { phrase: last, loose: tokens.length > 1, droppedDried: false },
  ]
  for (const { phrase, loose, droppedDried } of attempts) {
    // A single general word ("seeds", "oil") is never enough to pick a food when other words came with it.
    if (loose && TOO_GENERIC.has(last)) continue
    for (const candidate of [phrase, phrase.split(' ').map(singular).join(' ')]) {
      const hit = searchIngredients(all, candidate, 1)[0]
      if (!hit || !isTheFood(hit, candidate)) continue
      // "dried" only means the same food for herbs and spices; dried apricots are not apricots.
      if (droppedDried && hit.category !== 'spices-herbs') continue
      return { ingredient: hit, loose, word: last }
    }
  }
  return null
}

const CITRUS_JUICE_ML: Record<string, number> = { lemon: 45, lime: 30, orange: 60, grapefruit: 100 }

/** "Juice of 1 lemon" -> "45 ml lemon juice"; "Zest of 2 limes" -> "12 g lime". Other lines pass through unchanged. */
function normalizeCitrus(text: string): string {
  // "zest and juice of 1 lemon" and "juice & zest 1 lemon" count as the juice: the zest is only a few grams
  const m = text.match(/^(zest\s*(?:and|&)\s*juice|juice\s*(?:and|&)\s*zest|juice|zest)\s+(?:of\s+)?(\d+(?:\.\d+)?|\d+\/\d+|an?|one|half)?\s*(lemon|lime|orange|grapefruit)s?\b/i)
  if (!m) return text
  const raw = (m[2] ?? '1').toLowerCase()
  const n = raw === 'half' ? 0.5 : raw.includes('/') ? Number(raw.split('/')[0]) / Number(raw.split('/')[1]) : Number(raw) || 1
  const fruit = m[3].toLowerCase()
  // plain "zest" is a few grams of the fruit; anything that includes the juice is counted as the juice
  return /^zest$/i.test(m[1]) ? `${Math.round(n * 6)} g ${fruit}` : `${Math.round(n * CITRUS_JUICE_ML[fruit])} ml ${fruit} juice`
}

/** Foods named after "such as": "whole fish such as sea bass, sea trout or Dover sole". */
function matchAlternatives(text: string, all: Ingredient[]): FoodMatch | null {
  const alt = text.match(/\bsuch as\b(.*)$/i)
  if (!alt) return null
  for (const option of alt[1].split(/,|\bor\b/)) {
    const words = option
      .toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !NOISE.has(w))
      .join(' ')
    const hit = words ? bestMatch(words, all) : null
    if (hit) return { ...hit, fromOptions: true }
  }
  return null
}

/** Strips "in oil", "in brine" and the like, which describe the packing, not the food. */
const PACKED_IN = /\s+in\s+(?:olive\s+|tomato\s+|spring\s+)?(?:oil|water|brine|juice|syrup)\b.*$/i

interface Prefix {
  count: number | null
  size: number
  /** A normal unit like cup or tbsp. */
  unit: [Unit, number] | null
  /** A vague measure like pinch or bunch, as its base form. */
  vague: string | null
  /** Grams in one can, when written like "(14 oz) can". */
  packSizeGrams: number | null
  /** The part of the line that described the amount, for the note shown to the user. */
  phrase: string
  rest: string
}

/** Splits a line into its amount (count, size word, measure) and the food name that follows. */
function parsePrefix(line: string): Prefix {
  let t = line.trim()
  let count: number | null = null
  const num = parseNumber(t)
  if (num) {
    count = num.value
    t = num.rest.trim()
  } else {
    let m: RegExpMatchArray | null
    if ((m = t.match(/^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b\s*/i))) count = NUMBER_WORDS[m[1].toLowerCase()]
    else if ((m = t.match(/^half\s+(?:an?\s+|of\s+an?\s+|of\s+)?/i))) count = 0.5
    else if ((m = t.match(/^(?:a\s+)?couple\s+(?:of\s+)?/i))) count = 2
    else if ((m = t.match(/^(?:a\s+)?few\s+(?:of\s+)?|^several\s+(?:of\s+)?/i))) count = 3
    else if ((m = t.match(/^a\s+dozen\s+(?:of\s+)?/i))) count = 12
    else if ((m = t.match(/^an?\s+/i))) count = 1
    else if ((m = t.match(/^some\s+(?:of\s+)?/i))) count = null
    if (m) t = t.slice(m[0].length)
  }

  let packSizeGrams: number | null = null
  const pack = t.match(/^\(([^)]*)\)\s*/)
  if (pack) {
    const inner = parseNumber(pack[1].trim())
    const unit = inner ? UNITS[inner.rest.trim().toLowerCase()] : undefined
    if (inner && unit?.[0] === 'g') packSizeGrams = inner.value * unit[1]
    t = t.slice(pack[0].length)
  }

  let size = 1
  let sizeWord = ''
  for (;;) {
    const sm = t.match(/^([a-z]+)[\s-]+/i)
    const factor = sm ? SIZE[sm[1].toLowerCase()] : undefined
    if (!sm || factor === undefined) break
    size = factor
    sizeWord = sm[1].toLowerCase()
    t = t.slice(sm[0].length)
  }

  let unit: [Unit, number] | null = null
  let vague: string | null = null
  const word = t.match(/^([a-z]+)\.?(?=\s|$|,)/i)
  if (word) {
    const w = word[1].toLowerCase()
    if (UNITS[w]) unit = UNITS[w]
    else if (VAGUE[w]) vague = VAGUE[w]
    if (unit || vague) t = t.slice(word[0].length).replace(/^\s*(?:of\s+)?/i, '')
  }
  // "1 can (15 oz) black beans": the size can also follow the word "can".
  if (vague === 'can' && packSizeGrams == null) {
    const pk = t.match(/^\(([^)]*)\)\s*/)
    const inner = pk ? parseNumber(pk[1].trim()) : null
    const u = inner ? UNITS[inner.rest.trim().toLowerCase()] : undefined
    if (pk && inner && u?.[0] === 'g') {
      packSizeGrams = inner.value * u[1]
      t = t.slice(pk[0].length)
    }
  }
  // "a little salt", "some salt": no measure word, but clearly a small amount.
  if (!unit && !vague && (sizeWord === 'little' || /^some\b/i.test(line.trim()))) {
    vague = 'little'
    size = 1 // "little" is the amount itself here, not a scale on another measure
  }

  const rest = t.trim()
  const phrase = line.trim().slice(0, line.trim().length - rest.length).trim().replace(/\s+of$/i, '')
  return { count, size, unit, vague, packSizeGrams, phrase, rest }
}

/** Reads one ingredient line such as "1 1/2 cups rolled oats" or "a small bunch of parsley" and guesses which food it is. */
export function parseIngredientLine(line: string, all: Ingredient[]): ParsedLine {
  const source = line.trim()
  let cleaned = normalizeCitrus(source.replace(/^[-*••\s]+/, ''))
    .replace(ALTERNATE_MEASURE, '$1$2')
    .replace(PACK_COUNT, (_m, n: string, size: string, u: string) => `${Number(n) * Number(size)}${u} `)
  const toTaste = TO_TASTE.test(cleaned)
  const bracketGrams = bracketWeightGrams(cleaned)
  cleaned = cleaned.replace(TO_TASTE, ' ')
  const p = parsePrefix(cleaned)

  let name = p.rest
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bsuch as\b.*$/i, ' ')
    .split(',')[0]
    .replace(PACKED_IN, '')
    .toLowerCase()
    .split(/[\s/]+/)
    .filter((w) => w && !NOISE.has(w))
    .join(' ')
    .trim()
  // A bare "pepper" is the seasoning, unless it is counted like a vegetable ("1 pepper", "2 peppers").
  if (name === 'pepper' && (p.unit || p.vague || p.count == null)) name = 'black pepper'
  const found = bestMatch(name, all) ?? matchAlternatives(p.rest, all)
  const match = found?.ingredient ?? null

  let qty: number | null = null
  let unit: Unit = 'piece'
  let estimated = false
  let note = ''

  if (found?.fromOptions) note = `The recipe lists several options. Picked ${found.ingredient.name}. Change it if you use another.`
  else if (found?.loose) note = `Matched “${found.word}” loosely. Check it's the right food.`

  if (p.vague) {
    const est = match ? estimateVague(p.vague, match) : null
    if (est) {
      const grams = p.vague === 'can' && p.packSizeGrams != null ? { qty: p.packSizeGrams, unit: 'g' as Unit } : est
      qty = Math.round((p.count ?? 1) * p.size * grams.qty * 100) / 100
      unit = grams.unit
      estimated = true
      note = join(note, `Estimated from “${p.phrase}”. Check the amount.`)
    } else if (match) {
      note = join(note, `Couldn't estimate “${p.phrase}” for ${match.name}. Enter an amount.`)
    } else {
      note = join(note, `Couldn't estimate “${p.phrase}”. Pick a food and enter an amount.`)
    }
  } else if (p.unit) {
    if (p.count != null) {
      qty = Math.round(p.count * p.unit[1] * 100) / 100
      unit = p.unit[0]
    }
  } else if (p.count != null && bracketGrams != null) {
    // "2 whole fish (about 400g)": the weight in brackets is per item.
    qty = Math.round(p.count * bracketGrams)
    unit = 'g'
    estimated = true
    note = join(note, `Used the weight in brackets (${Math.round(bracketGrams)} g each). Check the amount.`)
  } else if (p.count != null) {
    qty = p.count
  } else if (match && match.category === 'fats-oils') {
    // "for frying", "as needed": assume a tablespoon.
    qty = 1
    unit = 'tbsp'
    estimated = true
    note = join(note, 'No amount given. Estimated 1 tablespoon. Check the amount.')
  } else if (match && (match.category === 'spices-herbs' || isSalt(match))) {
    // "salt to taste", or a seasoning with no amount at all: assume a pinch.
    const est = estimateVague('pinch', match)!
    qty = est.qty
    unit = est.unit
    estimated = true
    note = join(note, toTaste ? 'Estimated from “to taste”. Check the amount.' : 'No amount given. Estimated a pinch. Check the amount.')
  }

  // Beans and lentils: tinned or cooked ones weigh and count very differently from dry ones (a 400 g tin of
  // chickpeas has about a third of the calories of 400 g dry), so pick the tinned or cooked food when it applies.
  let food = match
  if (food && food.category === 'legumes' && qty != null) {
    const variant = cannedVariant(food, all)
    const saysTinned = /\b(canned|tinned|can|tin)\b/i.test(source)
    const saysCooked = /\b(cooked|drained)\b/i.test(source)
    const looksLikeATin = unit === 'g' && qty >= 380 && qty <= 450 && !/\b(dry|dried|soaked|raw|uncooked)\b/i.test(source)
    if (variant && (saysTinned || saysCooked || looksLikeATin)) {
      food = variant
      if (!saysTinned && !saysCooked) note = join(note, 'Treated as a tin of beans, since that much dry would be unusual. Check the amount.')
    }
    // A tin's label weight includes the liquid, so only about 60% is beans.
    if (TINNED.test(food.name) && unit === 'g' && !/\bdrained\b/i.test(source) && (p.vague === 'can' || saysTinned || looksLikeATin)) {
      qty = Math.round(qty * 0.6)
      estimated = true
      note = join(note, `A tin's weight includes liquid, so counted ${qty} g of beans. Check the amount.`)
    }
  }
  const tinnedFood = food != null && TINNED.test(food.name)

  // Calories and protein are worked out from raw foods, so a cooked weight has to be turned back into a raw one.
  if (/\bcooked\b/i.test(source) && match && qty != null && !tinnedFood) {
    const factor = cookedFactor(match)
    if (factor && unit === 'g') {
      const raw = Math.round(qty / factor)
      note = join(note, `Listed as cooked. Converted to about ${raw} g raw (cooked ${match.name.toLowerCase()} weighs about ${Math.round(factor * 100)}% of raw). Check the amount.`)
      qty = raw
      estimated = true
    } else {
      note = join(note, 'Listed as cooked. Calories here use raw values, so enter the raw weight if you can.')
    }
  }

  return { source, qty, unit, text: name, match: food, estimated, note }
}

const TINNED = /\((canned|cooked)\)$/i

/** The tinned or cooked version of a dry bean or lentil, if we have one. */
function cannedVariant(food: Ingredient, all: Ingredient[]): Ingredient | undefined {
  const names: Record<string, string> = {
    Chickpeas: 'Chickpeas (canned)',
    'Black beans': 'Black beans (canned)',
    'Kidney beans': 'Kidney beans (canned)',
    'White beans': 'White beans (canned)',
    'Pinto beans': 'Pinto beans (canned)',
    Lentils: 'Lentils (cooked)',
  }
  return names[food.name] ? all.find((i) => i.name === names[food.name]) : undefined
}

/** Cooked weight as a multiple of raw weight: meat loses water, grains and beans soak it up. Null when unknown. */
export function cookedFactor(ing: Ingredient): number | null {
  if (ing.category === 'meat' || ing.category === 'seafood') return 0.75
  if (/pasta|noodle|spaghetti/i.test(ing.name)) return 2.25
  if (ing.category === 'grains') return 2.8
  if (ing.category === 'legumes') return 2.3
  return null
}

const join = (a: string, b: string) => (a ? `${a} ${b}` : b)

/**
 * Splits "salt and pepper to taste" into two lines when each half is a known food and the
 * line has no numbers. Otherwise the line is kept whole.
 */
function splitSeasonings(line: string, all: Ingredient[]): string[] {
  if (/\d/.test(line) || !/\s(?:and|&)\s/i.test(line)) return [line]
  const taste = line.match(TO_TASTE)?.[0] ?? ''
  const parts = line
    .replace(TO_TASTE, ' ')
    .split(/\s+(?:and|&)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length < 2) return [line]
  const parsed = parts.map((s) => parseIngredientLine(`${s} ${taste}`.trim(), all))
  return parsed.every((p) => p.match) ? parts.map((s) => `${s} ${taste}`.trim()) : [line]
}

/** Lines that label the paste rather than name an ingredient: "Ingredients", "Units: US", "For Sauce", "Serves: 4". */
const HEADINGS = [
  /^(ingredients?|directions?|instructions?|method|notes?)\s*:?$/i,
  /^units?\s*:.*$/i,
  /^(serves|servings|yield|makes|ready in|prep time|cook time|total time|prep|cook)\s*:.*$/i,
  /^for\s+[^\d]*$/i,
  /^[^\d]*:$/,
  /^(sauce|marinade|filling|topping|dressing|garnish|glaze|batter|dough|crust|seasoning|rub|to serve)$/i,
]

/** A line holding only an amount, as copied from sites that put the number on its own line. */
const LONE_NUMBER = /^(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\d*\s*[½¼¾⅓⅔⅛])$/

/**
 * Cleans a pasted block into ingredient lines: drops headings and blank lines, and joins an amount
 * on its own line ("4") with the line after it ("ounces ground chicken"). Also reports what it skipped.
 */
export function cleanPastedBlock(block: string): { lines: string[]; skipped: string[] } {
  const lines: string[] = []
  const skipped: string[] = []
  let pending: string | null = null
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (HEADINGS.some((h) => h.test(line))) {
      skipped.push(line)
      continue
    }
    if (LONE_NUMBER.test(line)) {
      if (pending) skipped.push(pending)
      pending = line
      continue
    }
    lines.push(pending ? `${pending} ${line}` : line)
    pending = null
  }
  if (pending) skipped.push(pending)
  return { lines, skipped }
}

/** Parses pasted text into ingredient lines, and also returns the lines that were skipped as not being ingredients. */
export function parseIngredientBlockDetailed(block: string, all: Ingredient[]): { lines: ParsedLine[]; skipped: string[] } {
  const { lines, skipped } = cleanPastedBlock(block)
  return {
    lines: lines.flatMap((l) => splitSeasonings(l, all)).map((l) => parseIngredientLine(l, all)),
    skipped,
  }
}

/** Parses a block of pasted text, one ingredient per line. */
export function parseIngredientBlock(block: string, all: Ingredient[]): ParsedLine[] {
  return parseIngredientBlockDetailed(block, all).lines
}
