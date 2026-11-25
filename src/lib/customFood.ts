import { CATEGORY_BY_ID } from '../data/categories'
import { TAGS } from '../data/tags'
import type { Ingredient, StorageLocation } from '../types'
import { ML_PER_UNIT } from './units'

const LOCATIONS: StorageLocation[] = ['fridge', 'freezer', 'pantry']

/** What the add-a-food form holds while you type. Numbers are kept as text so half-typed values are fine. */
export interface FoodDraft {
  name: string
  category: string
  /** Does the label give nutrition per 100 g, or per serving? */
  basis: 'per100g' | 'perServing'
  /** The serving size in grams, when the label is per serving. */
  servingGrams: string
  kcal: string
  protein: string
  tags: string[]
  /** Other names, separated by commas. */
  aliases: string
  gramsPerPiece: string
  /** What one cup of it weighs, in grams. */
  gramsPerCup: string
  /** Days it lasts in each place. Blank means it is not kept there. */
  shelf: Record<StorageLocation, string>
  /** The product's barcode number, when it was scanned. Lets the next scan find this food straight away. */
  barcode: string
}

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s))

/** Shelf-life boxes filled in from the category's usual values. */
export function shelfForCategory(category: string): Record<StorageLocation, string> {
  const days = CATEGORY_BY_ID.get(category)?.shelfLifeDays ?? {}
  return { fridge: days.fridge ? String(days.fridge) : '', freezer: days.freezer ? String(days.freezer) : '', pantry: days.pantry ? String(days.pantry) : '' }
}

export function emptyDraft(name = ''): FoodDraft {
  return {
    name,
    category: 'pantry',
    basis: 'per100g',
    servingGrams: '',
    kcal: '',
    protein: '',
    tags: [],
    aliases: '',
    gramsPerPiece: '',
    gramsPerCup: '',
    shelf: shelfForCategory('pantry'),
    barcode: '',
  }
}

/** Fill the form from an existing food, so it can be edited. Nutrition is always shown per 100 g. */
export function draftFromIngredient(i: Ingredient): FoodDraft {
  const shelf = { fridge: '', freezer: '', pantry: '' } as Record<StorageLocation, string>
  for (const l of LOCATIONS) if (i.shelfLifeDays[l]) shelf[l] = String(i.shelfLifeDays[l])
  return {
    name: i.name,
    category: i.category,
    basis: 'per100g',
    servingGrams: '',
    kcal: String(i.kcalPer100g),
    protein: String(i.proteinPer100g),
    tags: [...i.tags],
    aliases: i.aliases.join(', '),
    gramsPerPiece: i.gramsPerPiece ? String(i.gramsPerPiece) : '',
    gramsPerCup: i.gramsPerMl ? String(Math.round(i.gramsPerMl * ML_PER_UNIT.cup! * 10) / 10) : '',
    shelf,
    barcode: i.barcode ?? '',
  }
}

/** Calories and protein per 100 g, whichever way the label gives them. Null until the numbers are usable. */
export function per100g(d: Pick<FoodDraft, 'basis' | 'servingGrams' | 'kcal' | 'protein'>): { kcal: number; protein: number } | null {
  const kcal = num(d.kcal)
  const protein = d.protein.trim() === '' ? 0 : num(d.protein)
  if (!Number.isFinite(kcal) || !Number.isFinite(protein)) return null
  if (d.basis === 'per100g') return { kcal, protein }
  const grams = num(d.servingGrams)
  if (!(grams > 0)) return null
  return { kcal: (kcal * 100) / grams, protein: (protein * 100) / grams }
}

const normalize = (s: string) => s.toLowerCase().replace(/-/g, ' ').replace(/\s+/g, ' ').trim()

type Field = 'name' | 'category' | 'servingGrams' | 'kcal' | 'protein' | 'shelf' | 'gramsPerPiece' | 'gramsPerCup'

export interface DraftCheck {
  /** Problems that stop it being saved, by field. */
  errors: Partial<Record<Field, string>>
  /** Things worth a second look, which do not stop it being saved. */
  warnings: string[]
}

export function checkDraft(d: FoodDraft, existing: Ingredient[], editingId?: number): DraftCheck {
  const errors: DraftCheck['errors'] = {}
  const warnings: string[] = []

  const name = d.name.trim()
  if (!name) errors.name = 'Give the food a name.'
  else {
    const clash = existing.find((e) => e.id !== editingId && normalize(e.name) === normalize(name))
    if (clash) errors.name = `You already have a food called “${clash.name}”.`
  }

  if (!CATEGORY_BY_ID.has(d.category)) errors.category = 'Pick what kind of food it is.'

  if (d.basis === 'perServing' && !(num(d.servingGrams) > 0)) errors.servingGrams = 'Enter the serving size in grams.'
  if (!Number.isFinite(num(d.kcal)) || num(d.kcal) < 0) errors.kcal = 'Enter the calories, or 0 if there are none.'
  if (d.protein.trim() !== '' && (!Number.isFinite(num(d.protein)) || num(d.protein) < 0)) errors.protein = 'Enter protein in grams, or leave it blank for none.'

  const n = per100g(d)
  if (n) {
    if (!errors.kcal && n.kcal > 900) {
      errors.kcal = `That works out to ${Math.round(n.kcal)} kcal per 100 g, which is more than any food has (pure fat is about 900). Check the label amount.`
    }
    if (!errors.protein && n.protein > 100) {
      errors.protein = `That works out to ${Math.round(n.protein)} g protein per 100 g, which is more than 100. Check the label amount.`
    }
    if (!errors.kcal && !errors.protein && n.protein * 4 > n.kcal * 1.2 + 10) {
      warnings.push(
        `Protein alone gives about ${Math.round(n.protein * 4)} kcal per 100 g, more than the ${Math.round(n.kcal)} kcal you entered. Check both numbers are for the same amount.`,
      )
    }
  }

  const kept = LOCATIONS.filter((l) => num(d.shelf[l]) > 0)
  if (kept.length === 0) errors.shelf = 'Say where it is kept, with a number of days.'
  for (const l of LOCATIONS) {
    if (d.shelf[l].trim() !== '' && !(num(d.shelf[l]) > 0)) errors.shelf = 'Days must be a number above 0, or blank if it is not kept there.'
  }

  if (d.gramsPerPiece.trim() !== '' && !(num(d.gramsPerPiece) > 0)) errors.gramsPerPiece = 'Enter a weight in grams.'
  if (d.gramsPerCup.trim() !== '' && !(num(d.gramsPerCup) > 0)) errors.gramsPerCup = 'Enter a weight in grams.'

  const code = d.barcode.trim()
  if (code) {
    const clash = existing.find((e) => e.id !== editingId && e.barcode === code)
    if (clash) errors.name = `This barcode already belongs to “${clash.name}”.`
  }

  if (d.tags.length === 0) {
    warnings.push('No allergens or triggers are ticked, so this food will be treated as safe for you. Tick anything it contains or is made from.')
  }
  return { errors, warnings }
}

/** The food to save. Call only when `checkDraft` found no errors. */
export function buildIngredient(d: FoodDraft): Omit<Ingredient, 'id'> {
  const n = per100g(d)!
  const name = d.name.trim()
  const aliases = [...new Set(d.aliases.split(',').map((a) => a.trim().toLowerCase()).filter((a) => a && a !== name.toLowerCase()))]
  const shelfLifeDays: Ingredient['shelfLifeDays'] = {}
  for (const l of LOCATIONS) if (num(d.shelf[l]) > 0) shelfLifeDays[l] = Math.round(num(d.shelf[l]))
  const piece = num(d.gramsPerPiece)
  const cup = num(d.gramsPerCup)
  return {
    name,
    aliases,
    category: d.category,
    tags: [...d.tags],
    shelfLifeDays,
    kcalPer100g: Math.round(n.kcal),
    proteinPer100g: Math.round(n.protein * 10) / 10,
    sensitivity: 'safe',
    ...(piece > 0 ? { gramsPerPiece: piece } : {}),
    ...(cup > 0 ? { gramsPerMl: Math.round((cup / ML_PER_UNIT.cup!) * 1000) / 1000 } : {}),
    custom: true,
    ...(d.barcode.trim() ? { barcode: d.barcode.trim() } : {}),
  }
}

// ---------- suggesting tags from the name ----------

interface Rule {
  tags: string[]
  words: string[]
  /** Words that cancel the rule: "almond milk" is not dairy. */
  unless?: string[]
}

const PLANT = ['coconut', 'almond', 'oat', 'soy', 'soya', 'rice', 'cashew', 'plant', 'vegan', 'hemp', 'pea']
const GLUTEN_FREE = ['rice', 'corn', 'almond', 'coconut', 'chickpea', 'buckwheat', 'tapioca', 'potato', 'gluten free', 'gf']

const RULES: Rule[] = [
  { tags: ['dairy', 'lactose'], words: ['milk', 'cream', 'yogurt', 'yoghurt', 'kefir', 'ricotta', 'custard', 'cottage', 'condensed'], unless: PLANT },
  { tags: ['dairy'], words: ['cheese', 'butter', 'ghee', 'whey', 'casein', 'paneer', 'halloumi', 'mozzarella', 'cheddar', 'parmesan', 'feta', 'brie', 'gouda'], unless: ['peanut', 'almond', 'nut', 'vegan', 'dairy free'] },
  { tags: ['egg'], words: ['egg', 'mayo', 'mayonnaise', 'meringue', 'aioli'] },
  { tags: ['gluten', 'wheat'], words: ['wheat', 'bread', 'pasta', 'noodle', 'spaghetti', 'macaroni', 'couscous', 'semolina', 'bulgur', 'seitan', 'spelt', 'farro', 'cracker', 'biscuit', 'cake', 'pastry', 'pizza', 'breadcrumb'], unless: ['gluten free', 'gf'] },
  { tags: ['gluten', 'wheat'], words: ['flour'], unless: GLUTEN_FREE },
  { tags: ['gluten'], words: ['rye', 'barley', 'malt', 'beer'] },
  { tags: ['oats'], words: ['oat', 'oatmeal', 'porridge', 'granola', 'muesli'] },
  { tags: ['soy', 'legumes'], words: ['soy', 'soya', 'tofu', 'tempeh', 'miso', 'edamame', 'tamari', 'shoyu'] },
  { tags: ['peanut', 'legumes'], words: ['peanut', 'groundnut'] },
  { tags: ['tree-nut'], words: ['almond', 'walnut', 'cashew', 'pecan', 'hazelnut', 'pistachio', 'macadamia', 'marzipan', 'praline'] },
  { tags: ['sesame'], words: ['sesame', 'tahini', 'halva', 'hummus'] },
  { tags: ['fish'], words: ['fish', 'salmon', 'tuna', 'cod', 'haddock', 'mackerel', 'sardine', 'anchovy', 'anchovies', 'trout', 'halibut', 'herring', 'tilapia', 'snapper', 'pollock', 'swordfish', 'worcestershire'] },
  { tags: ['shellfish'], words: ['shrimp', 'prawn', 'crab', 'lobster', 'mussel', 'oyster', 'clam', 'squid', 'scallop', 'calamari', 'crayfish'] },
  { tags: ['corn'], words: ['corn', 'maize', 'polenta', 'cornmeal', 'cornstarch', 'grits', 'popcorn'] },
  { tags: ['legumes'], words: ['bean', 'lentil', 'chickpea', 'pea', 'lupin', 'hummus', 'dal', 'dhal', 'falafel'] },
  { tags: ['onion-garlic'], words: ['onion', 'garlic', 'leek', 'shallot', 'chive', 'scallion'] },
  { tags: ['cruciferous'], words: ['broccoli', 'cabbage', 'kale', 'cauliflower', 'brussels', 'radish', 'turnip', 'collard', 'bok choy'] },
  { tags: ['nightshade'], words: ['tomato', 'potato', 'eggplant', 'aubergine', 'paprika', 'chilli', 'chili', 'cayenne', 'jalapeno', 'capsicum', 'ketchup', 'salsa', 'harissa'] },
  { tags: ['nightshade'], words: ['pepper'], unless: ['black', 'white', 'pink', 'szechuan', 'sichuan'] },
  { tags: ['spicy'], words: ['chilli', 'chili', 'cayenne', 'jalapeno', 'habanero', 'sriracha', 'harissa', 'wasabi'] },
  { tags: ['alcohol'], words: ['wine', 'beer', 'vodka', 'rum', 'whisky', 'whiskey', 'brandy', 'sherry', 'gin', 'liqueur', 'sake'] },
]

const singular = (w: string) => (w.endsWith('ies') && w.length > 4 ? `${w.slice(0, -3)}y` : w.endsWith('es') && w.length > 4 ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)

/**
 * Tags a food's name hints at, that are not ticked yet. These are suggestions to confirm, never applied silently,
 * and they are not a substitute for reading the label: "dairy free" and "gluten free" cancel their own rules.
 */
export function suggestTags(name: string, current: string[]): string[] {
  const text = normalize(name)
  const tokens = new Set(text.split(' ').flatMap((w) => [w, singular(w)]))
  const has = (w: string) => (w.includes(' ') ? text.includes(w) : tokens.has(w) || tokens.has(singular(w)))
  const found = new Set<string>()
  for (const rule of RULES) {
    if (!rule.words.some(has) || rule.unless?.some(has)) continue
    for (const t of rule.tags) found.add(t)
  }
  // "lactose free" milk is still dairy, but not lactose.
  if (has('lactose') && has('free')) found.delete('lactose')
  if (has('dairy') && has('free')) {
    found.delete('dairy')
    found.delete('lactose')
  }
  return TAGS.map((t) => t.id).filter((id) => found.has(id) && !current.includes(id))
}
