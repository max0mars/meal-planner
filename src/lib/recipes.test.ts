import '../test/fakeServer'
import { freshDatabase } from '../test/resetDb'
import { describe, expect, it } from 'vitest'
import seed from '../data/ingredients.seed.json'
import type { Ingredient, Recipe, Sensitivity } from '../types'
import { parseIngredientBlock, parseIngredientLine } from './parseIngredients'
import { recipeNutrition } from './nutrition'
import { classifyRecipe } from './recipeSafety'
import { seedIfEmpty } from './seed'
import { toGrams } from './units'

// Real seeded ingredients, with ids assigned the way the database would.
const all: Ingredient[] = (seed as Ingredient[]).map((i, n) => ({ ...i, id: n + 1 }))
const byName = (name: string) => all.find((i) => i.name === name)!
const byId = new Map(all.map((i) => [i.id!, i]))
const line = (name: string, qty: number, unit: Recipe['ingredients'][number]['unit'] = 'g') => ({ ingredientId: byName(name).id!, qty, unit })
const noTags = new Map<string, Sensitivity>()

describe('toGrams', () => {
  it('converts volumes using density and pieces using piece weight', () => {
    expect(toGrams(2, 'g', byName('Eggs'))).toBe(2)
    expect(toGrams(2, 'piece', byName('Eggs'))).toBe(100)
    expect(toGrams(1, 'cup', byName('All-purpose flour'))).toBeCloseTo(125.4, 0)
    expect(toGrams(1, 'tbsp', byName('Olive oil'))).toBeCloseTo(13.6, 0)
    expect(toGrams(250, 'ml', byName('Whole milk'))).toBeCloseTo(257.5, 0)
  })

  it('returns null for pieces of something with no known piece weight', () => {
    expect(toGrams(1, 'piece', byName('Rice noodles'))).toBeNull()
  })
})

describe('recipeNutrition', () => {
  it('adds up calories and protein and divides by servings', () => {
    const recipe = { servings: 2, ingredients: [line('Eggs', 4, 'piece'), line('Whole milk', 100, 'ml')] }
    const n = recipeNutrition(recipe, byId)
    // 4 eggs = 200 g at 143 kcal/100 g, 12.6 g protein/100 g; plus 103 g milk
    expect(n.totalKcal).toBeCloseTo(200 * 1.43 + 103 * 0.61, 0)
    expect(n.proteinPerServing).toBeCloseTo((200 * 0.126 + 103 * 0.032) / 2, 0)
    expect(n.uncounted).toEqual([])
  })

  it('reports ingredients it could not convert instead of guessing', () => {
    const n = recipeNutrition({ servings: 1, ingredients: [line('Rice noodles', 2, 'piece'), line('Eggs', 100, 'g')] }, byId)
    expect(n.uncounted.map((i) => i.name)).toEqual(['Rice noodles'])
    expect(n.totalGrams).toBe(100)
  })
})

describe('classifyRecipe', () => {
  const plain = { ingredients: [line('Chicken breast', 400), line('White rice', 200), line('Broccoli', 200)] }

  it('is ok when nothing is flagged', () => {
    expect(classifyRecipe(plain, byId, noTags, 0.25).status).toBe('ok')
  })

  it('excludes a recipe with any major ingredient, even a tiny amount', () => {
    const tags = new Map<string, Sensitivity>([['gluten', 'major']])
    const r = classifyRecipe({ ingredients: [...plain.ingredients, line('Soy sauce', 5)] }, byId, tags, 0.25)
    expect(r.status).toBe('excluded')
    expect(r.reasons[0]).toMatchObject({ kind: 'major', via: ['gluten'] })
  })

  it('warns when a light ingredient is within its limit', () => {
    const tags = new Map<string, Sensitivity>([['onion-garlic', 'light']])
    const r = classifyRecipe({ ingredients: [...plain.ingredients, line('Onion', 40)] }, byId, tags, 0.25)
    expect(r.status).toBe('warn')
    expect(r.reasons[0]).toMatchObject({ kind: 'light-ok', level: 'light' })
  })

  it('excludes a recipe when a light ingredient is above its own limit', () => {
    const tags = new Map<string, Sensitivity>([['onion-garlic', 'light']])
    // 300 g onion out of 1100 g total is 27%, over the 15% limit
    const r = classifyRecipe({ ingredients: [...plain.ingredients, line('Onion', 300)] }, byId, tags, 0.5)
    expect(r.status).toBe('excluded')
    expect(r.reasons[0].kind).toBe('light-too-much')
  })

  it('excludes when several light ingredients together pass the combined cap', () => {
    const tags = new Map<string, Sensitivity>([['onion-garlic', 'light'], ['cruciferous', 'light']])
    // onion 10% and broccoli 14% are each under 15%, but together exceed a 20% cap
    const recipe = { ingredients: [line('Chicken breast', 760), line('Onion', 100), line('Broccoli', 140)] }
    const r = classifyRecipe(recipe, byId, tags, 0.2)
    expect(r.reasons.every((x) => x.kind === 'light-ok')).toBe(true)
    expect(r.combined?.share).toBeCloseTo(0.24, 2)
    expect(r.status).toBe('excluded')
  })

  it('counts an ingredient listed on several lines together', () => {
    const tags = new Map<string, Sensitivity>([['onion-garlic', 'light']])
    const recipe = { ingredients: [line('Chicken breast', 800), line('Onion', 100), line('Onion', 100)] }
    const r = classifyRecipe(recipe, byId, tags, 0.5)
    expect(r.reasons).toHaveLength(1)
    expect(r.reasons[0].share).toBeCloseTo(0.2, 2)
    expect(r.status).toBe('excluded')
  })

  it('an ingredient-level label works without any category', () => {
    const own = new Map(all.map((i) => [i.id!, i]))
    own.set(byName('Eggs').id!, { ...byName('Eggs'), sensitivity: 'major' })
    expect(classifyRecipe({ ingredients: [line('Eggs', 2, 'piece')] }, own, noTags, 0.25).status).toBe('excluded')
  })
})

describe('parseIngredientLine', () => {
  const parse = (s: string) => parseIngredientLine(s, all)

  it('reads quantity, unit and food', () => {
    const p = parse('2 cups rolled oats')
    expect(p).toMatchObject({ qty: 2, unit: 'cup' })
    expect(p.match?.name).toBe('Rolled oats')
  })

  it('handles fractions, mixed numbers and unicode fractions', () => {
    expect(parse('1/2 cup white rice').qty).toBe(0.5)
    expect(parse('1 1/2 cups white rice').qty).toBe(1.5)
    expect(parse('½ tsp salt').qty).toBe(0.5)
  })

  it('converts weights to grams and takes the first number of a range', () => {
    expect(parse('1 lb ground beef')).toMatchObject({ qty: 453.6, unit: 'g' })
    expect(parse('8 oz salmon')).toMatchObject({ qty: 226.8, unit: 'g' })
    expect(parse('1-2 tbsp olive oil')).toMatchObject({ qty: 1, unit: 'tbsp' })
  })

  it('treats a bare count as pieces and ignores prep words', () => {
    const p = parse('3 large eggs')
    expect(p).toMatchObject({ qty: 3, unit: 'piece' })
    expect(p.match?.name).toBe('Eggs')
    expect(parse('2 cloves garlic, minced').match?.name).toBe('Garlic')
    expect(parse('2 cloves garlic, minced').unit).toBe('piece')
  })

  it('matches plurals and multi-word foods', () => {
    expect(parse('200 g boneless skinless chicken breasts').match?.name).toBe('Chicken breast')
    expect(parse('1 cup raspberries').match?.name).toBe('Raspberries')
    expect(parse('2 tomatoes').match?.name).toBe('Tomato')
    expect(parse('1 cup whole milk').match?.name).toBe('Whole milk')
    expect(parse('2 whole eggs').match?.name).toBe('Eggs')
    expect(parse('2 slices whole wheat bread').match?.name).toBe('Whole wheat bread')
  })

  it('returns no match rather than a wrong one for unknown foods', () => {
    expect(parse('1 cup zzzfoodthatdoesnotexist').match).toBeNull()
  })

  it('parses a block, skipping blank lines and bullets', () => {
    const lines = parseIngredientBlock('- 2 eggs\n\n* 1 cup whole milk\n', all)
    expect(lines.map((l) => l.match?.name)).toEqual(['Eggs', 'Whole milk'])
  })
})

describe('seed backfill', () => {
  it('fills in unit conversions on ingredients from an older install without touching labels', async () => {
    const database = await freshDatabase()
    await seedIfEmpty(database)
    const eggs = (await database.ingredients.where('name').equals('Eggs').first())!
    expect(eggs.gramsPerPiece).toBe(50)

    // simulate an older install: no conversion data, and the user marked eggs major
    await database.ingredients.update(eggs.id!, { gramsPerPiece: undefined, sensitivity: 'major' })
    await seedIfEmpty(database)
    const after = (await database.ingredients.where('name').equals('Eggs').first())!
    expect(after.gramsPerPiece).toBe(50)
    expect(after.sensitivity).toBe('major')
  })
})

describe('describeReason', () => {
  it('words each kind of flag in plain language', async () => {
    const { describeReason, pct } = await import('./recipeSafety')
    const onion = byName('Onion')
    const base = { ingredient: onion, share: 0.27, limit: 0.15, via: ['onion-garlic'] }
    expect(describeReason({ ...base, level: 'major', kind: 'major' })).toBe('Onion: Major sensitivity (onion & garlic)')
    expect(describeReason({ ...base, level: 'light', kind: 'light-too-much' })).toBe(
      'Onion: 27% of the recipe, over your 15% limit for Light foods (onion & garlic)',
    )
    expect(describeReason({ ...base, share: 0.04, level: 'light', kind: 'light-ok' })).toBe(
      'Onion: Light sensitivity (onion & garlic), 4% of the recipe',
    )
    expect(pct(0.004)).toBe('<1%')
    expect(pct(0)).toBe('0%')
  })
})

describe('vague amounts and real-world recipe wording', () => {
  const parse = (s: string) => parseIngredientLine(s, all)
  const amount = (s: string) => {
    const p = parse(s)
    return `${p.qty} ${p.unit}`
  }

  it('turns pinches, dashes and little amounts into small spoon measures', () => {
    expect(amount('a pinch of salt')).toBe('0.25 tsp')
    expect(amount('2 pinches cayenne pepper')).toBe('0.5 tsp')
    expect(amount('a generous pinch of cumin')).toBe('0.38 tsp')
    expect(amount('a dash of balsamic vinegar')).toBe('0.25 tsp')
    expect(amount('a little olive oil')).toBe('1 tsp')
    expect(amount('some black pepper')).toBe('0.25 tsp')
  })

  it('turns splashes, drizzles and knobs into tablespoons', () => {
    expect(amount('a splash of olive oil')).toBe('1 tbsp')
    expect(amount('a drizzle of honey')).toBe('1 tbsp')
    expect(amount('a knob of butter')).toBe('1 tbsp')
    expect(amount('a good glug of olive oil')).toBe('3 tbsp')
  })

  it('sizes handfuls, bunches and sprigs by the kind of food', () => {
    expect(amount('a handful of spinach')).toBe('30 g')
    expect(amount('a handful of parsley')).toBe('10 g')
    expect(amount('a small handful of almonds')).toBe('15 g')
    expect(amount('small bunch fresh parsley')).toBe('15 g')
    expect(amount('a bunch of parsley')).toBe('30 g')
    expect(amount('1 large bunch cilantro')).toBe('60 g')
    expect(amount('a bunch of green onions')).toBe('90 g')
    expect(amount('3 sprigs of thyme')).toBe('6 g')
    expect(amount('a few sprigs of rosemary')).toBe('6 g')
  })

  it('reads cans, heads and sticks, including a size in brackets', () => {
    expect(amount('1 can chickpeas')).toBe('240 g') // a 400 g tin is about 240 g of chickpeas once the liquid is drained
    expect(amount('2 (14 oz) cans tomatoes')).toBe('793.8 g')
    expect(amount('1 can of tuna')).toBe('140 g')
    expect(amount('1 head broccoli')).toBe('300 g')
    expect(amount('1 stick butter')).toBe('113 g')
  })

  it('reads number words, "a", half and a couple', () => {
    expect(amount('two cloves garlic')).toBe('2 piece')
    expect(amount('a lemon')).toBe('1 piece')
    expect(amount('a couple of eggs')).toBe('2 piece')
    expect(amount('half an onion')).toBe('0.5 piece')
    expect(amount('a few cloves of garlic')).toBe('3 piece')
    expect(amount('a dozen eggs')).toBe('12 piece')
    expect(amount('half a cup of white rice')).toBe('0.5 cup')
  })

  it('says when an amount is an estimate, and when it cannot guess', () => {
    expect(parse('a pinch of salt')).toMatchObject({ estimated: true })
    expect(parse('a pinch of salt').note).toMatch(/Estimated from “a pinch”/)
    expect(parse('2 cups white rice').estimated).toBe(false)
    const unknown = parse('a pack of chicken breast')
    expect(unknown.qty).toBeNull()
    const cantGuess = parse('a bunch of chicken breast')
    expect(cantGuess.qty).toBeNull()
    expect(cantGuess.note).toMatch(/Couldn't estimate/)
  })

  it('handles seasonings with no amount, or "to taste"', () => {
    expect(parse('salt, to taste')).toMatchObject({ qty: 0.25, unit: 'tsp', estimated: true })
    expect(parse('freshly ground black pepper').note).toMatch(/Estimated a pinch/)
    const both = parseIngredientBlock('salt and pepper to taste', all)
    expect(both.map((l) => l.match?.name)).toEqual(['Salt', 'Black pepper'])
    expect(both.every((l) => l.qty === 0.25 && l.unit === 'tsp')).toBe(true)
  })

  it('does not split a food that merely contains "and"', () => {
    expect(parseIngredientBlock('2 cups white rice and beans', all)).toHaveLength(1)
  })

  describe('a real recipe pasted from a UK website', () => {
    const recipe = `750g/1lb 10oz new potatoes
1 small unwaxed lemon, sliced
1 tbsp black onion seeds
1 x 280g jar sundried tomatoes in oil
¼ tsp caster sugar
2 whole fish (about 400g/14oz) such as sea bass, sea trout or Dover sole, cleaned
small bunch fresh parsley
small bunch lemon thyme
sea salt and freshly ground black pepper`
    const lines = parseIngredientBlock(recipe, all)
    const row = (needle: string) => lines.find((l) => l.source.includes(needle))!

    it('splits "sea salt and pepper" into two lines, giving ten lines from nine', () => {
      expect(lines).toHaveLength(10)
    })

    it('keeps the metric weight when both metric and imperial are given', () => {
      expect(row('potatoes')).toMatchObject({ qty: 750, unit: 'g' })
      expect(row('potatoes').match?.name).toBe('Potato')
    })

    it('reads "1 x 280g jar" as 280 g and ignores "in oil"', () => {
      expect(row('sundried')).toMatchObject({ qty: 280, unit: 'g' })
      expect(row('sundried').match?.name).toBe('Sun-dried tomatoes (in oil)')
    })

    it('uses the weight in brackets for the fish, and picks from the options listed', () => {
      expect(row('whole fish')).toMatchObject({ qty: 800, unit: 'g', estimated: true })
      expect(row('whole fish').match?.name).toBe('Sea bass')
      expect(row('whole fish').note).toMatch(/several options/)
    })

    it('estimates the bunches, the pinch of sugar, and the seasonings', () => {
      expect(row('parsley')).toMatchObject({ qty: 15, unit: 'g' })
      expect(row('lemon thyme')).toMatchObject({ qty: 15, unit: 'g' })
      expect(row('sugar')).toMatchObject({ qty: 0.25, unit: 'tsp' })
      expect(row('sea salt').match?.name).toBe('Salt')
      expect(row('pepper').match?.name).toBe('Black pepper')
    })

    it('does not guess a wrong food for black onion seeds', () => {
      expect(row('black onion seeds').match).toBeNull()
      expect(row('black onion seeds')).toMatchObject({ qty: 1, unit: 'tbsp' })
    })
  })

  it('does not let one general word pick a food', () => {
    expect(parse('1 tbsp rye flour').match).toBeNull()
    expect(parse('1 cup soya milk').match).toBeNull()
    expect(parse('1 tbsp olive oil').match?.name).toBe('Olive oil')
    expect(parse('1 cup coconut milk').match?.name).toBe('Coconut milk (canned)')
  })
})

describe('fish and shellfish', () => {
  const parse = (s: string) => parseIngredientLine(s, all)
  const food = (s: string) => parse(s).match?.name

  it('has the common fish, each tagged fish, and shellfish tagged shellfish', () => {
    for (const name of ['Salmon', 'Cod', 'Fresh tuna', 'Mackerel', 'Halibut', 'Catfish', 'Mahi-mahi', 'Snapper', 'Swordfish', 'Herring', 'Pollock', 'Flounder or sole', 'Anchovies', 'Smoked salmon', 'Canned salmon']) {
      expect(byName(name).tags, name).toContain('fish')
    }
    for (const name of ['Shrimp', 'Mussels', 'Oysters', 'Lobster', 'Clams', 'Squid', 'Crab', 'Scallops']) {
      expect(byName(name).tags, name).toContain('shellfish')
    }
  })

  it('finds fish by the names recipes use', () => {
    expect(food('2 salmon fillets')).toBe('Salmon')
    expect(food('400 g cod fillets')).toBe('Cod')
    expect(food('2 tuna steaks')).toBe('Fresh tuna')
    expect(food('1 mahi mahi fillet')).toBe('Mahi-mahi')
    expect(food('2 Dover sole')).toBe('Flounder or sole')
    expect(food('4 anchovy fillets')).toBe('Anchovies')
    expect(food('100 g smoked salmon')).toBe('Smoked salmon')
    expect(food('1 can pink salmon')).toBe('Canned salmon')
    expect(food('300 g calamari')).toBe('Squid')
  })

  it('treats bare "tuna" as the tinned kind, with a tin weighing 140 g', () => {
    expect(food('1 can tuna')).toBe('Canned tuna')
    expect(parse('1 can tuna')).toMatchObject({ qty: 140, unit: 'g' })
  })

  it('does not mistake oyster sauce for oysters, or a tuna steak for beef', () => {
    expect(parse('1 tbsp oyster sauce').match?.name).toBe('Oyster sauce')
    expect(food('2 tuna steaks')).not.toBe('Beef sirloin steak')
  })

  it('a fish category setting flags every fish at once', () => {
    const tags = new Map<string, Sensitivity>([['fish', 'major']])
    const r = classifyRecipe({ ingredients: [line('Halibut', 300), line('Potato', 200)] }, byId, tags, 0.25)
    expect(r.status).toBe('excluded')
    expect(r.reasons[0]).toMatchObject({ kind: 'major', via: ['fish'] })
  })
})

describe('pasting from sites that put the number on its own line', () => {
  const site = `ingredients
Units: US
4
ounces ground chicken (cooked)
14
ounces chow fun noodles
2
tablespoons minced scallions
1
teaspoon minced garlic
1
teaspoon chili paste
1
teaspoon szechwan preserved vegetables
2
tablespoons shredded black fungus mushrooms
For Sauce
2
tablespoons soy sauce
2
tablespoons vinegar
2
tablespoons granulated sugar
1
teaspoon oyster sauce
1
teaspoon mushroom soy sauce
2
tablespoons water`

  it('drops headings and tells you what it dropped', async () => {
    const { cleanPastedBlock } = await import('./parseIngredients')
    const { lines, skipped } = cleanPastedBlock(site)
    expect(skipped).toEqual(['ingredients', 'Units: US', 'For Sauce'])
    expect(lines).toHaveLength(13)
    expect(lines[0]).toBe('4 ounces ground chicken (cooked)')
    expect(lines[12]).toBe('2 tablespoons water')
  })

  it('recognises other headings and details, but never a real ingredient', async () => {
    const { cleanPastedBlock } = await import('./parseIngredients')
    const skippedOf = (s: string) => cleanPastedBlock(s).skipped
    expect(skippedOf('Ingredients:\nFor the marinade:\nSauce\nServes: 4\nPrep time: 10 mins\nDirections')).toHaveLength(6)
    expect(skippedOf('salt\n2 cups rice\nsoy sauce\n1/2 cup milk')).toEqual([])
  })

  it('joins a lone number with the next line, including fractions', async () => {
    const { cleanPastedBlock } = await import('./parseIngredients')
    expect(cleanPastedBlock('1/2\ncup white rice\n1 1/2\ntsp salt\n¼\ntsp sugar').lines).toEqual([
      '1/2 cup white rice',
      '1 1/2 tsp salt',
      '¼ tsp sugar',
    ])
  })

  it('reports a dangling number instead of inventing an ingredient', async () => {
    const { cleanPastedBlock } = await import('./parseIngredients')
    expect(cleanPastedBlock('2 cups rice\n3').skipped).toEqual(['3'])
  })

  it('parses every ingredient in the recipe with the right amount and food', () => {
    const lines = parseIngredientBlock(site, all)
    const row = (needle: string) => lines.find((l) => l.source.includes(needle))!
    expect(lines).toHaveLength(13)
    expect(row('chow fun')).toMatchObject({ qty: 396.9, unit: 'g' })
    expect(row('chow fun').match?.name).toBe('Rice noodles')
    expect(row('scallions')).toMatchObject({ qty: 2, unit: 'tbsp' })
    expect(row('scallions').match?.name).toBe('Green onion')
    expect(row('garlic')).toMatchObject({ qty: 1, unit: 'tsp' })
    expect(row('granulated').match?.name).toBe('Sugar')
    expect(row('oyster').match?.name).toBe('Oyster sauce')
    expect(row('mushroom soy').match?.name).toBe('Soy sauce')
    expect(row('vinegar').match?.name).toBe('Apple cider vinegar')
    expect(row('water').match?.name).toBe('Water')
    expect(row('water')).toMatchObject({ qty: 2, unit: 'tbsp' })
  })

  it('does not guess for foods it does not have', () => {
    const lines = parseIngredientBlock(site, all)
    expect(lines.find((l) => l.source.includes('chili paste'))!.match).toBeNull()
    expect(lines.find((l) => l.source.includes('szechwan'))!.match).toBeNull()
  })

  it('converts a cooked weight to raw, and says so', () => {
    const p = parseIngredientBlock(site, all).find((l) => l.source.includes('ground chicken'))!
    expect(p).toMatchObject({ qty: 151, unit: 'g', estimated: true })
    expect(p.match?.name).toBe('Ground chicken')
    expect(p.note).toMatch(/Listed as cooked. Converted to about 151 g raw/)
  })

  it('converts cooked rice and pasta by weight, and flags cooked amounts by volume', () => {
    const parse = (s: string) => parseIngredientLine(s, all)
    expect(parse('300 g cooked white rice')).toMatchObject({ qty: 107, unit: 'g' })
    expect(parse('450 g cooked wheat pasta')).toMatchObject({ qty: 200, unit: 'g' })
    expect(parse('460 g cooked black beans')).toMatchObject({ qty: 460, unit: 'g' }) // cooked beans have their own food, so no conversion
    const byCup = parse('2 cups cooked white rice')
    expect(byCup).toMatchObject({ qty: 2, unit: 'cup' })
    expect(byCup.note).toMatch(/Listed as cooked. Calories here use raw values/)
    expect(parse('200 g raw chicken breast').note).toBe('')
  })

  it('treats water as water, not watermelon', () => {
    expect(parseIngredientLine('2 cups water', all).match?.name).toBe('Water')
    expect(recipeNutrition({ servings: 1, ingredients: [line('Water', 250, 'ml')] }, byId).totalKcal).toBe(0)
  })
})

describe('servings guess', () => {
  it('guesses mains for 4, baking for 8 and breakfast for 2', async () => {
    const { guessServings } = await import('./guessServings')
    expect(guessServings('Beef', 763)).toBe(4)
    expect(guessServings('Chicken', 1800)).toBe(4)
    expect(guessServings('Dessert', 3000)).toBe(8)
    expect(guessServings('Breakfast', 900)).toBe(2)
    expect(guessServings(null, 1200)).toBe(4)
  })

  it('adds servings when a serving would be huge, and removes them when it would be tiny', async () => {
    const { guessServings } = await import('./guessServings')
    expect(guessServings('Beef', 6000)).toBe(6) // 4 servings would be 1500 kcal each; 6 is 1000
    expect(guessServings('Beef', 7000)).toBe(8) // 6 servings would still be 1167 kcal each
    expect(guessServings('Side', 200)).toBe(1) // a sauce or dressing
    expect(guessServings('Vegetarian', 300)).toBe(2)
  })

  it('reproduces the first release guess so older installs can be corrected', async () => {
    const { legacyServingsGuess } = await import('./guessServings')
    expect(legacyServingsGuess(763)).toBe(1)
    expect(legacyServingsGuess(1900)).toBe(3)
    expect(legacyServingsGuess(99999)).toBe(8)
  })
})

describe('Thai beef stir-fry (checked against the original recipe: 178 kcal and 22 g protein per serving)', () => {
  it('lands close to the published numbers once servings are right', async () => {
    const recipes = (await import('../data/recipes.seed.json')).default as {
      title: string
      servings: number
      ingredients: { name: string; qty: number; unit: 'g' | 'ml' | 'piece' | 'cup' | 'tbsp' | 'tsp' }[]
    }[]
    const r = recipes.find((x) => x.title === 'Thai beef stir-fry')!
    expect(r.servings).toBe(4)
    const n = recipeNutrition({ servings: r.servings, ingredients: r.ingredients.map((l) => ({ ingredientId: byName(l.name).id!, qty: l.qty, unit: l.unit })) }, byId)
    expect(n.proteinPerServing).toBeGreaterThan(20)
    expect(n.proteinPerServing).toBeLessThan(24) // published: 22 g
    expect(n.kcalPerServing).toBeGreaterThan(165)
    expect(n.kcalPerServing).toBeLessThan(215) // published: 178
  })
})

describe('staples mentioned in the steps but missing from the ingredients', () => {
  const rice = byName('White rice')
  const steps = ['Heat the oil.', 'Stir in the basil leaves and serve with plain rice.']
  const base = { steps, ingredients: [line('Beef chuck roast', 400)] }

  it('spots rice in "serve with plain rice"', async () => {
    const { unlistedStaples } = await import('./recipeHints')
    const found = unlistedStaples(base, all)
    expect(found.map((f) => f.ingredient.name)).toEqual(['White rice'])
    expect(found[0]).toMatchObject({ mention: 'rice', gramsPerServing: 75 })
  })

  it('says nothing when the staple is already listed', async () => {
    const { unlistedStaples } = await import('./recipeHints')
    expect(unlistedStaples({ steps, ingredients: [...base.ingredients, { ingredientId: rice.id!, qty: 200, unit: 'g' }] }, all)).toEqual([])
  })

  it('handles noodles, bread and potatoes, and several at once', async () => {
    const { unlistedStaples } = await import('./recipeHints')
    const names = (s: string[]) => unlistedStaples({ steps: s, ingredients: [] }, all).map((f) => f.ingredient.name)
    expect(names(['Serve over noodles.'])).toEqual(['Wheat pasta']) // the cautious reading: noodles may contain gluten
    expect(names(['Serve with crusty bread and a salad.'])).toEqual(['White bread'])
    expect(names(['Serve with boiled potatoes.'])).toEqual(['Potato'])
    expect(names(['Serve alongside rice and warm pita bread.']).sort()).toEqual(['Pita bread', 'White bread', 'White rice'].sort())
  })

  it('ignores staples that are not about serving, and things that are not staples', async () => {
    const { unlistedStaples } = await import('./recipeHints')
    const names = (s: string[]) => unlistedStaples({ steps: s, ingredients: [] }, all).map((f) => f.ingredient.name)
    expect(names(['Boil the rice for 10 minutes.', 'Cook the pasta.'])).toEqual([])
    expect(names(['Serve with lime wedges and a sprinkle of parsley.'])).toEqual([])
    expect(names(['Serve immediately.'])).toEqual([])
  })

  it('does not flag "rice" inside other words', async () => {
    const { unlistedStaples } = await import('./recipeHints')
    expect(unlistedStaples({ steps: ['Serve with licorice and price tags.'], ingredients: [] }, all)).toEqual([])
  })
})

describe('recipe filters: beef, chicken, fish, pork, vegetarian and search', () => {
  const kinds = async (names: string[]) => {
    const { recipeKinds } = await import('./recipeFilters')
    return [...recipeKinds({ ingredients: names.map((n) => line(n, 100)) }, byId)].sort()
  }

  it('sorts by the main ingredient, using the ingredients themselves', async () => {
    expect(await kinds(['Beef chuck roast', 'Onion'])).toEqual(['beef'])
    expect(await kinds(['Ground beef (80/20)'])).toEqual(['beef'])
    expect(await kinds(['Chicken breast', 'White rice'])).toEqual(['chicken'])
    expect(await kinds(['Chicken thigh'])).toEqual(['chicken'])
    expect(await kinds(['Salmon', 'Potato'])).toEqual(['fish'])
    expect(await kinds(['Pork loin'])).toEqual(['pork'])
  })

  it('counts bacon, ham, sausages and chorizo as pork, and can put a recipe in more than one group', async () => {
    expect(await kinds(['Bacon', 'Eggs'])).toEqual(['pork'])
    expect(await kinds(['Ham'])).toEqual(['pork'])
    expect(await kinds(['Pork sausages'])).toEqual(['pork'])
    expect(await kinds(['Chorizo', 'Chicken thigh'])).toEqual(['chicken', 'pork'])
  })

  it('does not call a recipe beef or chicken just because of the stock', async () => {
    expect(await kinds(['Beef broth', 'Lentils', 'Carrot'])).toEqual([]) // animal stock: not vegetarian, but not a beef dish either
    expect(await kinds(['Chicken broth', 'Rice noodles'])).toEqual([])
  })

  it('treats shellfish as seafood but not as Fish, and sauces as not-fish', async () => {
    expect(await kinds(['Shrimp', 'Garlic'])).toEqual([])
    expect(await kinds(['Fish sauce', 'Rice noodles'])).toEqual([]) // hides an animal product: not vegetarian, not a fish dish
  })

  it('is vegetarian only when nothing comes from an animal, even a hidden one', async () => {
    expect(await kinds(['Lentils', 'Carrot', 'Eggs', 'Cheddar cheese'])).toEqual(['vegetarian']) // eggs and dairy are fine
    expect(await kinds(['Vegetable broth', 'Potato'])).toEqual(['vegetarian'])
    expect(await kinds(['Lentils', 'Chicken broth'])).toEqual([])
    expect(await kinds(['Wheat pasta', 'Worcestershire sauce'])).toEqual([])
    expect(await kinds(['Wheat pasta', 'Anchovies'])).toEqual(['fish'])
    expect(await kinds(['Bouillon cube', 'Potato'])).toEqual([])
    expect(await kinds(['Oyster sauce', 'Broccoli'])).toEqual([])
  })

  it('never makes an empty recipe vegetarian', async () => {
    expect(await kinds([])).toEqual([])
  })

  describe('search', () => {
    const recipe = { title: 'Chicken and rice bowl', category: 'Chicken', ingredients: [line('Chicken breast', 300), line('White rice', 150), line('Cilantro', 10), line('Eggplant', 100)] }
    const hit = async (q: string, r = recipe) => (await import('./recipeFilters')).matchesSearch(r, q, byId)

    it('finds by the recipe name and by its ingredients', async () => {
      expect(await hit('bowl')).toBe(true)
      expect(await hit('rice')).toBe(true)
      expect(await hit('eggplant')).toBe(true)
    })

    it('finds by other names for an ingredient', async () => {
      expect(await hit('coriander')).toBe(true) // Cilantro
      expect(await hit('aubergine')).toBe(true) // Eggplant
    })

    it('finds while still typing, ignoring case and plurals', async () => {
      expect(await hit('chick')).toBe(true)
      expect(await hit('RICE')).toBe(true)
      expect(await hit('eggplants')).toBe(true)
    })

    it('needs every word to match', async () => {
      expect(await hit('chicken rice')).toBe(true)
      expect(await hit('chicken salmon')).toBe(false)
    })

    it('does not match half-words of other names, or ingredients that are not there', async () => {
      const beefRecipe = { title: 'Burgers', category: 'Beef', ingredients: [line('Ground beef (80/20)', 400)] }
      expect(await hit('ham', beefRecipe)).toBe(false) // an alias of ground beef starts with "ham"
      expect(await hit('salmon')).toBe(false)
      expect(await hit('')).toBe(true)
    })
  })
})

describe('tinned and cooked beans are not dry beans', () => {
  const parse = (s: string) => parseIngredientLine(s, all)
  const kcal = (s: string) => {
    const p = parse(s)
    return recipeNutrition({ servings: 1, ingredients: [{ ingredientId: p.match!.id!, qty: p.qty!, unit: p.unit }] }, byId).totalKcal
  }

  it('picks the tinned food when the line says can, tin, tinned or canned', () => {
    expect(parse('1 can chickpeas').match?.name).toBe('Chickpeas (canned)')
    expect(parse('1 tin black beans').match?.name).toBe('Black beans (canned)')
    expect(parse('200 g tinned kidney beans').match?.name).toBe('Kidney beans (canned)')
    expect(parse('1 can cannellini beans').match?.name).toBe('White beans (canned)')
  })

  it('counts only the beans in a tin, since the label weight includes liquid', () => {
    expect(parse('1 can chickpeas')).toMatchObject({ qty: 240, unit: 'g', estimated: true })
    expect(parse('1 can (15 oz) black beans')).toMatchObject({ qty: 255, unit: 'g' }) // 425 g label x 60%
    expect(parse('1 can chickpeas').note).toMatch(/includes liquid/)
  })

  it('does not scale a weight that is already drained', () => {
    expect(parse('240 g drained tinned kidney beans')).toMatchObject({ qty: 240, unit: 'g' })
    expect(parse('240 g drained tinned kidney beans').match?.name).toBe('Kidney beans (canned)')
  })

  it('treats a plain tin-sized weight as a tin, and says so, but leaves other weights alone', () => {
    const tin = parse('400g chickpeas')
    expect(tin.match?.name).toBe('Chickpeas (canned)')
    expect(tin.qty).toBe(240)
    expect(tin.note).toMatch(/Treated as a tin/)
    expect(parse('150 g chickpeas').match?.name).toBe('Chickpeas') // a normal dry amount
    expect(parse('400 g dried chickpeas').match?.name).toBe('Chickpeas')
    expect(parse('400 g dried chickpeas').qty).toBe(400)
  })

  it('uses cooked lentils for cooked lentils, without converting the weight', () => {
    expect(parse('2 cups cooked lentils').match?.name).toBe('Lentils (cooked)')
    expect(parse('300 g cooked lentils')).toMatchObject({ qty: 300, unit: 'g' })
    expect(parse('100 g lentils').match?.name).toBe('Lentils')
  })

  it('stops a tin of chickpeas being counted as three times the calories', () => {
    // the Falafel case: "400g chickpeas" counted as 400 g dry was about 1,500 kcal; a drained tin is about 330
    expect(kcal('1 can chickpeas')).toBeGreaterThan(300)
    expect(kcal('1 can chickpeas')).toBeLessThan(360)
    expect(kcal('400g chickpeas')).toBeLessThan(360)
    expect(kcal('400 g dried chickpeas')).toBeGreaterThan(1400)
  })
})

describe('everyday UK and US wording', () => {
  const parse = (s: string) => parseIngredientLine(s, all)
  const food = (s: string) => parse(s).match?.name

  it('knows UK names: treacle, swede, passata, digestives, chicken legs', () => {
    expect(food('2 tbsp black treacle')).toBe('Molasses')
    expect(food('300 g swede')).toBe('Swede')
    expect(food('400 g passata')).toBe('Tomato sauce')
    expect(food('100 g digestive biscuits')).toBe('Digestive biscuits')
    expect(food('4 chicken legs')).toBe('Chicken leg')
    expect(parse('4 chicken legs')).toMatchObject({ qty: 4, unit: 'piece' })
  })

  it('reads pasta shapes as pasta, which carries the gluten tag', () => {
    for (const s of ['300 g penne rigate', '250 g lasagne sheets', '200 g bowtie pasta', '1 cup macaroni', '300 g linguine']) {
      expect(food(s), s).toBe('Wheat pasta')
    }
  })

  it('does not mistake varieties for different foods', () => {
    expect(food('2 Bramley apples')).toBe('Apple')
    expect(food('500 g Maris Piper potatoes')).toBe('Potato')
    expect(food('50 g flaked almonds')).toBe('Almonds')
    expect(food('3 free-range eggs')).toBe('Eggs')
  })

  it('counts "zest and juice of a lemon" as the juice, and a stick of celery as one stalk', () => {
    expect(parse('zest and juice of 1 lemon')).toMatchObject({ qty: 45, unit: 'ml' })
    expect(food('zest and juice of 1 lemon')).toBe('Lemon juice')
    expect(parse('juice of 2 limes')).toMatchObject({ qty: 60, unit: 'ml' })
    expect(parse('1 stick celery')).toMatchObject({ qty: 1, unit: 'piece' })
    expect(food('1 stick celery')).toBe('Celery')
  })

  it('keeps allergen tags on the new foods', () => {
    const tags = (n: string) => all.find((i) => i.name === n)!.tags
    expect(tags('Burger buns')).toEqual(expect.arrayContaining(['gluten', 'wheat']))
    expect(tags('Beer')).toEqual(expect.arrayContaining(['alcohol', 'gluten']))
    expect(tags('Pine nuts')).toContain('tree-nut')
    expect(tags('Brie')).toContain('dairy')
    expect(tags('Spirits')).toContain('alcohol')
  })
})

describe('animal fats are not vegetarian', () => {
  it('a recipe with lard, goose fat or suet is not called vegetarian', async () => {
    const { recipeKinds } = await import('./recipeFilters')
    const kinds = (names: string[]) => [...recipeKinds({ ingredients: names.map((n) => line(n, 100)) }, byId)]
    expect(kinds(['Lard', 'Potato', 'Carrot'])).toEqual([])
    expect(kinds(['Olive oil', 'Potato', 'Carrot'])).toEqual(['vegetarian']) // plant oils are fine
    expect(kinds(['Butter', 'Eggs', 'All-purpose flour'])).toEqual(['vegetarian']) // dairy and eggs are fine
  })
})
