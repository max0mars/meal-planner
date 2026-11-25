import { describe, expect, it } from 'vitest'
import seed from '../data/ingredients.seed.json'
import type { Ingredient, MealPlanEntry, MealSlot, PantryItem, Recipe, RecipeIngredient, Trip } from '../types'
import { recipeNutrition } from './nutrition'
import { cookSessions, weekDays } from './plan'
import { FAMILIAR_BONUS, LIKED_BONUS, planWeek, type Candidate } from './planner'
import { recipeKinds } from './recipeFilters'
import { byTripOrder, tripBefore, upcomingTrips } from './trips'

const all: Ingredient[] = (seed as Ingredient[]).map((i, n) => ({ ...i, id: n + 1 }))
const byId = new Map(all.map((i) => [i.id!, i]))
const food = (name: string) => all.find((i) => i.name === name)!
const line = (name: string, qty: number, unit: RecipeIngredient['unit'] = 'g'): RecipeIngredient => ({ ingredientId: food(name).id!, qty, unit })
let nextId = 1
const recipe = (title: string, lines: RecipeIngredient[], extra: Partial<Recipe> = {}): Recipe & { id: number } => ({
  id: nextId++, title, servings: 4, servingsPerMeal: 1, ingredients: lines, steps: ['Cook it.'], estMinutes: 30, actualMinutesHistory: [], ...extra,
})
const candidate = (r: Recipe & { id: number }, extra: Partial<Candidate> = {}): Candidate => {
  const n = recipeNutrition(r, byId)
  return { recipe: r, perServing: { kcal: n.kcalPerServing, protein: n.proteinPerServing }, kinds: recipeKinds(r, byId), warn: false, ...extra }
}
const entry = (date: string, slot: MealSlot, over: Partial<MealPlanEntry> = {}): MealPlanEntry => ({
  id: nextId++, date, slot, servingsPlanned: 1, status: 'planned', ...over,
})
const trip = (date: string, after: Trip['after'] = 'start'): Trip => ({ id: nextId++, date, after, time: '10:00' })
const stock = (name: string, qty: number, expiresOn = '2026-12-30'): PantryItem => ({
  ingredientId: food(name).id!, qty, unit: 'g', purchasedOn: '2026-11-19', expiresOn, location: 'fridge',
})

const TODAY = '2026-11-19' // a Thursday
const days = weekDays(TODAY, 7) // Thu 19 ... Wed 25
const [THU, FRI, , SUN, MON, TUE, WED] = days

const chicken = candidate(recipe('Chicken and rice', [line('Chicken breast', 400), line('White rice', 200), line('Broccoli', 200)]))
const beef = candidate(recipe('Beef stew', [line('Beef chuck roast', 500), line('Potato', 400), line('Carrot', 200)], { estMinutes: 120 }))
const salmon = candidate(recipe('Salmon and potatoes', [line('Salmon', 400), line('Potato', 400), line('Green beans', 200)], { estMinutes: 20 }))
const lentils = candidate(recipe('Lentil curry', [line('Lentils', 250), line('Onion', 200), line('Tomato', 300)], { estMinutes: 60 }))
const mains = [chicken, beef, salmon, lentils]
const base = { candidates: mains, byId, pantry: [] as PantryItem[], today: TODAY, kcalTarget: 3000, leftoverDays: 4, existing: [] as MealPlanEntry[] }

describe('trip timing', () => {
  it('a trip is before a meal if it is an earlier day, or earlier in the same day', () => {
    expect(tripBefore({ date: MON, after: 'start' }, MON, 'lunch')).toBe(true)
    expect(tripBefore({ date: MON, after: 'lunch' }, MON, 'lunch')).toBe(false) // after lunch is not before lunch
    expect(tripBefore({ date: MON, after: 'lunch' }, MON, 'dinner')).toBe(true)
    expect(tripBefore({ date: MON, after: 'dinner' }, MON, 'dinner')).toBe(false)
    expect(tripBefore({ date: MON, after: 'dinner' }, TUE, 'lunch')).toBe(true)
    expect(tripBefore({ date: TUE, after: 'start' }, MON, 'dinner')).toBe(false)
  })

  it('sorts trips, and drops those already gone', () => {
    const ts = [trip(TUE, 'dinner'), trip(MON, 'lunch'), trip(TUE, 'start'), trip('2026-11-10')]
    expect(upcomingTrips(ts, TODAY)).toHaveLength(3)
    expect([...upcomingTrips(ts, TODAY)].sort(byTripOrder).map((t) => `${t.date}${t.after}`)).toEqual([`${MON}lunch`, `${TUE}start`, `${TUE}dinner`])
  })
})

describe('leftovers', () => {
  it('eats the dinner you planned the night before, and keeps your constraint on the meal', () => {
    const lunch = entry(WED, 'lunch', { constraint: 'leftovers' })
    const r = planWeek({ ...base, days: [WED], slots: ['lunch', 'dinner'], existing: [entry(TUE, 'dinner', { recipeId: chicken.recipe.id }), lunch] })
    expect(r.update).toEqual([{ id: lunch.id, recipeId: chicken.recipe.id, servingsPlanned: 1 }])
    expect(r.add.find((a) => a.slot === 'lunch')).toBeUndefined() // the constraint entry is updated, not duplicated
    expect(r.unresolved).toEqual([])
  })

  it('with nothing planned the night before, cooks a big batch for it and reuses it', () => {
    const lunch = entry(WED, 'lunch', { constraint: 'leftovers' })
    const r = planWeek({ ...base, days: [WED], slots: ['lunch'], existing: [lunch] })
    expect(r.unresolved).toEqual([])
    const batch = r.add.find((a) => a.date === TUE && a.slot === 'dinner')!
    expect(batch).toBeTruthy()
    expect(r.update).toEqual([{ id: lunch.id, recipeId: batch.recipeId, servingsPlanned: 1 }])
    const cook = [...r.add.map((a, i) => ({ ...a, id: 900 + i })), { ...lunch, recipeId: batch.recipeId, id: 999 }]
    expect(cookSessions(cook, 4).filter((s) => s.recipeId === batch.recipeId)).toHaveLength(1) // one cook feeds both
    expect(mains.find((m) => m.recipe.id === batch.recipeId)!.recipe.servings).toBeGreaterThanOrEqual(2)
  })

  it('says so when you are eating out the night before', () => {
    const r = planWeek({ ...base, days: [WED], slots: ['lunch'], existing: [entry(TUE, 'dinner', { constraint: 'out' }), entry(WED, 'lunch', { constraint: 'leftovers' })] })
    expect(r.update).toEqual([])
    expect(r.unresolved).toEqual([{ date: WED, slot: 'lunch', reason: expect.stringMatching(/eating out the night before/) }])
  })

  it('cannot make leftovers from a night that has already passed', () => {
    const r = planWeek({ ...base, days: [THU], slots: ['lunch'], existing: [entry(THU, 'lunch', { constraint: 'leftovers' })] })
    expect(r.unresolved).toEqual([{ date: THU, slot: 'lunch', reason: expect.stringMatching(/no dinner the night before/i) }])
    expect(r.add).toEqual([])
  })

  it('does not add a second dinner when the night before is itself waiting for a recipe it cannot get', () => {
    const r = planWeek({
      ...base, candidates: [], days: [TUE, WED], slots: [],
      existing: [entry(TUE, 'dinner', { constraint: 'quick' }), entry(WED, 'lunch', { constraint: 'leftovers' })],
    })
    expect(r.add).toEqual([])
    expect(r.unresolved.map((u) => `${u.date}${u.slot}`)).toEqual([`${TUE}dinner`, `${WED}lunch`])
  })

  it('cooks a big batch for the leftovers, even when a one-serving recipe would otherwise be the better pick', () => {
    const single = candidate(recipe('Single portion', [line('Chicken breast', 300)], { servings: 1 }), { liked: true })
    const lunch = entry(WED, 'lunch', { constraint: 'leftovers' })
    const r = planWeek({ ...base, candidates: [single, ...mains], days: [WED], slots: [], existing: [lunch] })
    const batch = r.add.find((a) => a.date === TUE && a.slot === 'dinner')!
    expect(batch.recipeId).not.toBe(single.recipe.id)
    // and with only a one-serving recipe to choose from, it still plans something rather than nothing
    const onlySingle = planWeek({ ...base, candidates: [single], days: [WED], slots: [], existing: [lunch] })
    expect(onlySingle.add[0].recipeId).toBe(single.recipe.id)
  })

  it('does not plan a second dinner on a night that already has a constraint it could not fill', () => {
    // Tuesday must be quick but nothing quick exists: Tuesday stays unresolved and is not quietly given a dinner by the leftovers rule
    const slow = [beef, lentils]
    const r = planWeek({
      ...base, candidates: slow, days: [TUE, WED], slots: [], quickMinutes: 30,
      existing: [entry(TUE, 'dinner', { constraint: 'quick' }), entry(WED, 'lunch', { constraint: 'leftovers' })],
    })
    expect(r.add).toEqual([])
    expect(r.update).toEqual([])
    expect(r.unresolved.map((u) => `${u.date}${u.slot}`)).toEqual([`${TUE}dinner`, `${WED}lunch`])
  })

  it('a dinner chosen earlier in the same run is what the leftovers come from', () => {
    const lunch = entry(WED, 'lunch', { constraint: 'leftovers' })
    const dinner = entry(TUE, 'dinner', { constraint: 'any' })
    const r = planWeek({ ...base, days: [TUE, WED], slots: [], existing: [dinner, lunch] })
    const cooked = r.update.find((u) => u.id === dinner.id)!
    expect(r.update.find((u) => u.id === lunch.id)!.recipeId).toBe(cooked.recipeId)
    expect(r.add).toEqual([])
  })
})

describe('eating out', () => {
  it('is left alone, gets no food, and is counted as a meal when sizing the day', () => {
    const small = candidate(recipe('Small plate', [line('Chicken breast', 300)]), { perServing: { kcal: 500, protein: 30 } })
    const big = candidate(recipe('Big plate', [line('Chicken breast', 300)]), { perServing: { kcal: 1200, protein: 30 } })
    const out = entry(FRI, 'dinner', { constraint: 'out' })
    const withOut = planWeek({ ...base, candidates: [small, big], days: [FRI], slots: ['lunch', 'dinner'], existing: [out], kcalTarget: 1200 })
    expect(withOut.add).toHaveLength(1)
    expect(withOut.add[0]).toMatchObject({ date: FRI, slot: 'lunch', recipeId: small.recipe.id }) // the meal out takes up part of the day
    expect(withOut.update).toEqual([])
    const without = planWeek({ ...base, candidates: [small, big], days: [FRI], slots: ['lunch'], kcalTarget: 1200 })
    expect(without.add[0].recipeId).toBe(big.recipe.id) // with nothing else planned, lunch is sized to the whole day
  })
})

describe('little time', () => {
  it('quick only picks recipes within the limit, even when a slower one would score higher', () => {
    const quick = entry(MON, 'dinner', { constraint: 'quick' })
    const slowLoved = { ...beef, liked: true }
    const r = planWeek({ ...base, candidates: [slowLoved, salmon], days: [MON], slots: ['dinner'], existing: [quick], quickMinutes: 30 })
    expect(r.update[0].recipeId).toBe(salmon.recipe.id) // 20 minutes; the 120 minute stew is excluded
    const none = planWeek({ ...base, candidates: [beef, lentils], days: [MON], slots: ['dinner'], existing: [quick], quickMinutes: 30 })
    expect(none.update).toEqual([])
    expect(none.unresolved[0]).toMatchObject({ date: MON, slot: 'dinner', reason: 'No recipe takes 30 minutes or less.' })
    const raised = planWeek({ ...base, candidates: [beef, lentils], days: [MON], slots: ['dinner'], existing: [quick], quickMinutes: 60 })
    expect(raised.update[0].recipeId).toBe(lentils.recipe.id)
  })

  it('a quick lunch is cooked fresh, not the dinner from the night before', () => {
    const lunch = entry(MON, 'lunch', { constraint: 'quick' })
    const r = planWeek({ ...base, candidates: [beef, salmon], days: [MON], slots: [], existing: [lunch, entry(SUN, 'dinner', { recipeId: beef.recipe.id })] })
    expect(r.update).toEqual([{ id: lunch.id, recipeId: salmon.recipe.id, servingsPlanned: 1 }]) // the 20 minute salmon, not the stew from last night
  })

  it('"let the planner choose" fills the meal, and is planned again next time', () => {
    const open = entry(MON, 'dinner', { constraint: 'any', recipeId: chicken.recipe.id }) // filled by an earlier run
    const r = planWeek({ ...base, candidates: [chicken], days: [MON], slots: ['dinner'], existing: [open] })
    expect(r.update).toEqual([{ id: open.id, recipeId: chicken.recipe.id, servingsPlanned: 1 }])
    const repeat = planWeek({ ...base, candidates: [chicken, salmon], days: [MON], slots: ['dinner'], existing: [open, entry(SUN, 'dinner', { recipeId: chicken.recipe.id })] })
    expect(repeat.update[0].recipeId).toBe(salmon.recipe.id) // the old pick no longer counts as planned, so variety sees only Sunday
  })

  it('never touches a meal you chose yourself, or one already cooked or skipped', () => {
    const mine = entry(MON, 'dinner', { recipeId: beef.recipe.id })
    const done = entry(MON, 'lunch', { recipeId: beef.recipe.id, status: 'cooked' })
    const r = planWeek({ ...base, days: [MON], slots: ['lunch', 'dinner'], existing: [mine, done] })
    expect(r.add).toEqual([])
    expect(r.update).toEqual([])
  })
})

describe('grocery trips', () => {
  const longLife = '2026-12-30'
  // a pantry that fully covers the chicken dish and nothing else
  const pantry = [stock('Chicken breast', 400, longLife), stock('White rice', 200, longLife), stock('Broccoli', 200, longLife)]

  it('with no trips, nothing is ruled out', () => {
    const r = planWeek({ ...base, days: [MON], slots: ['dinner'] })
    expect(r.add).toHaveLength(1)
    expect(r.unresolved).toEqual([])
  })

  it('before the first trip, only a meal the pantry covers can be planned', () => {
    const r = planWeek({ ...base, pantry, days: [MON], slots: ['dinner'], trips: [trip(WED)] })
    expect(r.add[0].recipeId).toBe(chicken.recipe.id)
    const empty = planWeek({ ...base, days: [MON], slots: ['dinner'], trips: [trip(WED)] })
    expect(empty.add).toEqual([])
    expect(empty.unresolved[0]).toMatchObject({ date: MON, slot: 'dinner', reason: expect.stringMatching(/before a grocery trip/) })
  })

  it('after a trip, anything can be planned', () => {
    const r = planWeek({ ...base, days: [MON, WED], slots: ['dinner'], trips: [trip(TUE)] })
    expect(r.add.map((a) => a.date)).toEqual([WED]) // Monday comes before the trip, and the pantry is empty
    expect(r.unresolved.map((u) => u.date)).toEqual([MON])
  })

  it('a trip after dinner does not help that dinner, but does help the next day', () => {
    const r = planWeek({ ...base, days: [MON, TUE], slots: ['dinner'], trips: [trip(MON, 'dinner')] })
    expect(r.add.map((a) => a.date)).toEqual([TUE])
    expect(r.unresolved.map((u) => u.date)).toEqual([MON])
    const before = planWeek({ ...base, days: [MON], slots: ['dinner'], trips: [trip(MON, 'lunch')] })
    expect(before.add).toHaveLength(1) // a trip after lunch comes before dinner
  })

  it('a trip that has already gone cannot buy food for later meals', () => {
    const r = planWeek({ ...base, days: [MON], slots: ['dinner'], trips: [trip('2026-11-12'), trip(WED)] })
    expect(r.add).toEqual([]) // only the trip on Wednesday counts, and Monday is before it
  })

  it('pantry food eaten by an earlier meal is not counted twice', () => {
    // a quarter of the recipe is one meal, so this is exactly one meal's chicken: the second dinner before the trip has none left
    const oneMeal = [stock('Chicken breast', 100, longLife), stock('White rice', 50, longLife), stock('Broccoli', 50, longLife)]
    const r = planWeek({ ...base, candidates: [chicken], pantry: oneMeal, days: [MON, TUE], slots: ['dinner'], trips: [trip(WED)] })
    expect(r.add.map((a) => a.date)).toEqual([MON])
    expect(r.unresolved.map((u) => u.date)).toEqual([TUE])
  })
})

describe('meals to leave alone', () => {
  it('skips the slots it is told to, including one you marked with a constraint', () => {
    const marked = entry(THU, 'lunch', { constraint: 'quick' })
    const r = planWeek({ ...base, days: [THU], slots: ['lunch', 'dinner'], existing: [marked], skipSlots: [`${THU}|lunch`] })
    expect(r.add.map((a) => a.slot)).toEqual(['dinner'])
    expect(r.update).toEqual([])
    expect(r.unresolved).toEqual([]) // left alone, not a failure
    const all = planWeek({ ...base, days: [THU], slots: ['lunch', 'dinner'], existing: [marked] })
    expect(all.update).toHaveLength(1)
    expect(all.add.map((a) => a.slot)).toEqual(['dinner'])
  })
})

describe('liking, disliking and familiar meals', () => {
  const twin = (title: string, extra: Partial<Candidate> = {}, over: Partial<Recipe> = {}) => candidate(recipe(title, [line('Chicken breast', 300), line('White rice', 100)], over), extra)
  const pick = (cs: Candidate[], over: Partial<Parameters<typeof planWeek>[0]> = {}) => planWeek({ ...base, candidates: cs, days: [MON], slots: ['dinner'], ...over }).add[0].recipeId

  it('a liked recipe beats an otherwise identical one, and the bonus is small enough that expiring food still wins', () => {
    const a = twin('Alpha')
    const z = twin('Zulu', { liked: true })
    expect(pick([a, z])).toBe(z.recipe.id)
    expect(pick([a, twin('Zulu', { liked: false })])).toBe(a.recipe.id) // identical: the earlier title wins the tie
    expect(LIKED_BONUS).toBeLessThan(1)
  })

  it('leans towards familiar dishes only when asked', () => {
    const a = twin('Alpha')
    const z = twin('Zulu', { familiar: true })
    expect(pick([a, z], { preferFamiliar: true })).toBe(z.recipe.id)
    expect(pick([a, z], { preferFamiliar: false })).toBe(a.recipe.id)
    expect(pick([a, z])).toBe(a.recipe.id)
    expect(FAMILIAR_BONUS).toBeLessThan(1)
  })

  it('never plans a recipe you disliked, even when it is the best by every measure', () => {
    const hated = twin('Alpha', { liked: true }, { rating: 'dislike' })
    const other = twin('Zulu')
    expect(pick([hated, other])).toBe(other.recipe.id)
    const only = planWeek({ ...base, candidates: [hated], days: [MON], slots: ['dinner'] })
    expect(only.add).toEqual([])
    expect(only.unresolved).toHaveLength(1)
  })

  it('a disliked recipe you chose yourself stays on the plan', () => {
    const hated = twin('Alpha', {}, { rating: 'dislike' })
    const r = planWeek({ ...base, candidates: [hated, twin('Zulu')], days: [MON], slots: ['dinner'], existing: [entry(MON, 'dinner', { recipeId: hated.recipe.id })] })
    expect(r.add).toEqual([])
    expect(r.update).toEqual([])
  })
})

describe('the week you described', () => {
  it('leftovers for lunch Wednesday, out for dinner Friday, little time Monday, groceries Monday and Thursday', () => {
    // this week starts on a Thursday; the days named fall in the week after, apart from "Thursday" which is today
    const existing = [
      entry(WED, 'lunch', { constraint: 'leftovers' }),
      entry(FRI, 'dinner', { constraint: 'out' }),
      entry(MON, 'lunch', { constraint: 'quick' }),
      entry(MON, 'dinner', { constraint: 'quick' }),
    ]
    const trips = [trip(MON, 'start'), trip(THU, 'start')]
    const pantry = [stock('Chicken breast', 400), stock('White rice', 200), stock('Broccoli', 200)]
    // plenty of recipes, so a meal you did not tag never has to repeat one and become leftovers
    const fillers = Array.from({ length: 24 }, (_, i) => candidate(recipe(`Filler ${i}`, [line('Chicken breast', 200 + i * 10), line('White rice', 100)], { estMinutes: 20 })))
    const r = planWeek({ ...base, pantry, candidates: [...mains, candidate(recipe('Egg toast', [line('Eggs', 200), line('White bread', 100)], { estMinutes: 10 })), ...fillers], days, slots: ['lunch', 'dinner'], existing, trips })

    const meal = (date: string, slot: MealSlot) => {
      const u = r.update.find((x) => existing.find((e) => e.id === x.id && e.date === date && e.slot === slot))
      return u?.recipeId ?? r.add.find((a) => a.date === date && a.slot === slot)?.recipeId
    }
    const minutes = (id?: number) => [...mains, ...base.candidates, ...fillers].find((c) => c.recipe.id === id)?.recipe.estMinutes
    // Friday dinner is out: nothing added for it
    expect(r.add.find((a) => a.date === FRI && a.slot === 'dinner')).toBeUndefined()
    // Monday is quick, both meals
    expect(minutes(meal(MON, 'lunch'))).toBeLessThanOrEqual(30)
    expect(minutes(meal(MON, 'dinner'))).toBeLessThanOrEqual(30)
    // Wednesday lunch is Tuesday's dinner
    expect(meal(WED, 'lunch')).toBe(meal(TUE, 'dinner'))
    expect(meal(WED, 'lunch')).toBeDefined()
    // every other slot is filled or explained, none silently dropped
    const open = days.flatMap((d) => (['lunch', 'dinner'] as MealSlot[]).map((s) => ({ d, s }))).filter(({ d, s }) => !(d === FRI && s === 'dinner'))
    for (const { d, s } of open) expect(meal(d, s) != null || r.unresolved.some((u) => u.date === d && u.slot === s), `${d} ${s}`).toBe(true)
  })
})
