import { describe, expect, it } from 'vitest'
import seed from '../data/ingredients.seed.json'
import type { Ingredient } from '../types'
import { buildIngredient, checkDraft, draftFromIngredient, emptyDraft, per100g, shelfForCategory, suggestTags, type FoodDraft } from './customFood'

const existing: Ingredient[] = (seed as Ingredient[]).map((i, n) => ({ ...i, id: n + 1 }))

/** A draft that passes every check. */
const good = (over: Partial<FoodDraft> = {}): FoodDraft => ({
  ...emptyDraft('Nigella seeds'),
  category: 'spices-herbs',
  kcal: '345',
  protein: '17',
  tags: ['onion-garlic'],
  shelf: shelfForCategory('spices-herbs'),
  ...over,
})

describe('nutrition per 100 g', () => {
  it('takes a per-100 g label as it is', () => {
    expect(per100g({ basis: 'per100g', servingGrams: '', kcal: '345', protein: '17' })).toEqual({ kcal: 345, protein: 17 })
  })

  it('converts a per-serving label using the serving size', () => {
    expect(per100g({ basis: 'perServing', servingGrams: '30', kcal: '120', protein: '6' })).toEqual({ kcal: 400, protein: 20 })
    const n = per100g({ basis: 'perServing', servingGrams: '45', kcal: '150', protein: '3' })!
    expect(n.kcal).toBeCloseTo(333.3, 1)
    expect(n.protein).toBeCloseTo(6.7, 1)
  })

  it('treats a blank protein as none, and waits for numbers it cannot use', () => {
    expect(per100g({ basis: 'per100g', servingGrams: '', kcal: '884', protein: '' })).toEqual({ kcal: 884, protein: 0 })
    expect(per100g({ basis: 'per100g', servingGrams: '', kcal: '', protein: '5' })).toBeNull()
    expect(per100g({ basis: 'perServing', servingGrams: '', kcal: '120', protein: '6' })).toBeNull()
    expect(per100g({ basis: 'perServing', servingGrams: '0', kcal: '120', protein: '6' })).toBeNull()
    expect(per100g({ basis: 'per100g', servingGrams: '', kcal: 'abc', protein: '5' })).toBeNull()
  })
})

describe('checking a new food', () => {
  it('accepts a complete food, with no warnings when allergens are ticked', () => {
    const r = checkDraft(good(), existing)
    expect(r.errors).toEqual({})
    expect(r.warnings).toEqual([])
  })

  it('needs a name, and not one you already have (ignoring case and hyphens)', () => {
    expect(checkDraft(good({ name: '  ' }), existing).errors.name).toMatch(/Give the food a name/)
    expect(checkDraft(good({ name: 'whole MILK' }), existing).errors.name).toMatch(/already have a food called “Whole milk”/)
    expect(checkDraft(good({ name: 'sun dried tomatoes (in oil)' }), existing).errors.name).toMatch(/already have a food called “Sun-dried tomatoes/)
    expect(checkDraft(good({ name: 'Mahi mahi' }), existing).errors.name).toMatch(/already have a food called “Mahi-mahi”/)
    expect(checkDraft(good({ name: 'Dolphinfish' }), existing).errors.name).toBeUndefined() // only another name for Mahi-mahi, not its name
  })

  it('lets you keep a food\'s own name while editing it', () => {
    const milk = existing.find((e) => e.name === 'Whole milk')!
    expect(checkDraft(good({ name: 'Whole milk' }), existing, milk.id).errors.name).toBeUndefined()
  })

  it('needs calories, and stops numbers that cannot be right', () => {
    expect(checkDraft(good({ kcal: '' }), existing).errors.kcal).toMatch(/Enter the calories/)
    expect(checkDraft(good({ kcal: '-5' }), existing).errors.kcal).toBeTruthy()
    expect(checkDraft(good({ kcal: '950' }), existing).errors.kcal).toMatch(/more than any food has/)
    // 300 kcal in a 30 g serving is 1000 kcal per 100 g: more than pure fat
    expect(checkDraft(good({ basis: 'perServing', servingGrams: '30', kcal: '300' }), existing).errors.kcal).toMatch(/1000 kcal per 100 g/)
    expect(checkDraft(good({ protein: '120' }), existing).errors.protein).toMatch(/more than 100/)
    expect(checkDraft(good({ basis: 'perServing', servingGrams: '', kcal: '120' }), existing).errors.servingGrams).toMatch(/serving size/)
  })

  it('accepts zero calories (water, salt) and blank protein', () => {
    expect(checkDraft(good({ kcal: '0', protein: '' }), existing).errors).toEqual({})
  })

  it('warns, without blocking, when protein alone outweighs the calories', () => {
    const r = checkDraft(good({ kcal: '80', protein: '30' }), existing)
    expect(r.errors).toEqual({})
    expect(r.warnings.some((w) => /Protein alone gives about 120 kcal/.test(w))).toBe(true)
    expect(checkDraft(good({ kcal: '120', protein: '30' }), existing).warnings).toEqual([]) // exactly 4 kcal per gram is fine
  })

  it('warns that an untagged food is treated as safe', () => {
    const r = checkDraft(good({ tags: [] }), existing)
    expect(r.errors).toEqual({})
    expect(r.warnings.some((w) => /treated as safe for you/.test(w))).toBe(true)
  })

  it('needs somewhere it is kept, with a real number of days', () => {
    expect(checkDraft(good({ shelf: { fridge: '', freezer: '', pantry: '' } }), existing).errors.shelf).toMatch(/where it is kept/)
    expect(checkDraft(good({ shelf: { fridge: 'soon', freezer: '', pantry: '10' } }), existing).errors.shelf).toMatch(/number above 0/)
    expect(checkDraft(good({ shelf: { fridge: '', freezer: '', pantry: '10' } }), existing).errors.shelf).toBeUndefined()
  })

  it('checks the optional weights', () => {
    expect(checkDraft(good({ gramsPerPiece: '-2' }), existing).errors.gramsPerPiece).toBeTruthy()
    expect(checkDraft(good({ gramsPerCup: 'x' }), existing).errors.gramsPerCup).toBeTruthy()
    expect(checkDraft(good({ gramsPerPiece: '40', gramsPerCup: '150' }), existing).errors).toEqual({})
  })
})

describe('building the food to save', () => {
  it('rounds the numbers, and marks it as yours and safe until you say otherwise', () => {
    const f = buildIngredient(good({ kcal: '344.6', protein: '16.96' }))
    expect(f).toMatchObject({ name: 'Nigella seeds', category: 'spices-herbs', kcalPer100g: 345, proteinPer100g: 17, sensitivity: 'safe', custom: true })
  })

  it('converts a per-serving label before saving', () => {
    expect(buildIngredient(good({ basis: 'perServing', servingGrams: '30', kcal: '120', protein: '6' }))).toMatchObject({ kcalPer100g: 400, proteinPer100g: 20 })
  })

  it('tidies other names: lower case, no repeats, never the name itself', () => {
    const f = buildIngredient(good({ aliases: ' Black Onion Seeds, kalonji , nigella seeds, kalonji ,, ' }))
    expect(f.aliases).toEqual(['black onion seeds', 'kalonji'])
  })

  it('keeps only the places with days, and turns a cup weight into a density', () => {
    const f = buildIngredient(good({ shelf: { fridge: '', freezer: '90.4', pantry: '365' }, gramsPerPiece: '40', gramsPerCup: '200' }))
    expect(f.shelfLifeDays).toEqual({ freezer: 90, pantry: 365 })
    expect(f.gramsPerPiece).toBe(40)
    expect(f.gramsPerMl).toBeCloseTo(0.845, 3) // 200 g / 236.6 ml
    expect(buildIngredient(good()).gramsPerPiece).toBeUndefined()
  })

  it('opening a food to edit and saving it unchanged gives the same food back', () => {
    for (const name of ['Eggs', 'Whole milk', 'Olive oil', 'Cinnamon', 'Sun-dried tomatoes (in oil)']) {
      const original = existing.find((e) => e.name === name)!
      const back = buildIngredient(draftFromIngredient(original))
      expect(back.name).toBe(original.name)
      expect(back.category).toBe(original.category)
      expect(back.kcalPer100g).toBe(original.kcalPer100g)
      expect(back.proteinPer100g).toBe(original.proteinPer100g)
      expect(back.tags).toEqual(original.tags)
      expect(back.shelfLifeDays).toEqual(original.shelfLifeDays)
      expect(back.aliases).toEqual(original.aliases.map((a) => a.toLowerCase()).filter((a) => a !== original.name.toLowerCase()))
      expect(back.gramsPerPiece).toBe(original.gramsPerPiece)
      if (original.gramsPerMl) expect(back.gramsPerMl).toBeCloseTo(original.gramsPerMl, 2)
    }
  })

  it('starts a new food with the shelf life usual for its category', () => {
    expect(shelfForCategory('meat')).toEqual({ fridge: '3', freezer: '270', pantry: '' })
    expect(shelfForCategory('spices-herbs')).toEqual({ fridge: '730', freezer: '', pantry: '730' })
    expect(shelfForCategory('nonsense')).toEqual({ fridge: '', freezer: '', pantry: '' })
  })
})

describe('suggesting allergen and trigger tags from a name', () => {
  const s = (name: string, ticked: string[] = []) => suggestTags(name, ticked)

  it('suggests tags the name hints at, in the usual order', () => {
    expect(s('Soy sauce')).toEqual(['soy', 'legumes'])
    expect(s('Wheat flour')).toEqual(['gluten', 'wheat'])
    expect(s('Cream cheese')).toEqual(['dairy', 'lactose'])
    expect(s('Cheddar')).toEqual(['dairy'])
    expect(s('Chilli powder').sort()).toEqual(['nightshade', 'spicy'])
    expect(s('Prawn crackers').sort()).toEqual(['gluten', 'shellfish', 'wheat'])
    expect(s('Hummus').sort()).toEqual(['legumes', 'sesame'])
    expect(s('Red wine vinegar')).toEqual(['alcohol'])
    expect(s('Red bell pepper')).toEqual(['nightshade'])
  })

  it('understands plurals', () => {
    expect(s('Eggs')).toEqual(['egg'])
    expect(s('Oysters')).toEqual(['shellfish'])
    expect(s('Chickpeas')).toEqual(['legumes'])
    expect(s('Tomatoes')).toEqual(['nightshade'])
  })

  it('does not call plant milks, nut butters or free-from foods by the wrong name', () => {
    expect(s('Almond milk')).toEqual(['tree-nut'])
    expect(s('Oat milk')).toEqual(['oats'])
    expect(s('Coconut cream')).toEqual([])
    expect(s('Peanut butter').sort()).toEqual(['legumes', 'peanut'])
    expect(s('Almond butter')).toEqual(['tree-nut'])
    expect(s('Rice flour')).toEqual([])
    expect(s('Gluten free pasta')).toEqual([])
    expect(s('Black pepper')).toEqual([])
    expect(s('Lactose-free milk')).toEqual(['dairy'])
    expect(s('Dairy-free yogurt')).toEqual([])
  })

  it('leaves out tags you have already ticked, and suggests nothing for plain foods', () => {
    expect(s('Wheat flour', ['gluten'])).toEqual(['wheat'])
    expect(s('Wheat flour', ['gluten', 'wheat'])).toEqual([])
    expect(s('Chicken breast')).toEqual([])
    expect(s('Peach')).toEqual([]) // "pea" is not "peach"
  })
})
