import type { Ingredient, MealPlanEntry, MealSlot, PantryItem, Recipe, Trip } from '../types'
import { addDays, daysBetween } from './expiry'
import { SLOT_ORDER, byDateThenSlot, cookSessions, isFoodsMeal, mealKey, mealNutrition, type PerServing } from './plan'
import type { KindId } from './recipeFilters'
import { isStaple } from './shopping'
import { tripBefore, upcomingTrips } from './trips'
import { toGrams } from './units'

/** A recipe the planner may choose: one you can cook (nothing Major in it), with its numbers worked out. */
export interface Candidate {
  recipe: Recipe & { id: number }
  perServing: PerServing
  kinds: Set<KindId>
  /** True when it contains a Light-sensitivity food, so it carries a warning. */
  warn: boolean
  /** An everyday dish for a western diet (see `isFamiliar`). The planner leans towards these when you ask it to. */
  familiar?: boolean
  /** You liked this recipe. */
  liked?: boolean
}

/** Kinds of dish for each meal. Recipes of your own with no kind are used for lunch and dinner only. */
const MEAL_KINDS: Record<MealSlot, (category: string | undefined) => boolean> = {
  breakfast: (c) => c === 'Breakfast',
  lunch: (c) => !['Dessert', 'Side', 'Starter', 'Breakfast'].includes(c ?? ''),
  dinner: (c) => !['Dessert', 'Side', 'Starter', 'Breakfast'].includes(c ?? ''),
  snack: (c) => ['Dessert', 'Side', 'Starter'].includes(c ?? ''),
}

export function suitsSlot(candidate: Candidate, slot: MealSlot): boolean {
  const mainSlot = slot === 'lunch' || slot === 'dinner'
  return MEAL_KINDS[slot](candidate.recipe.category) && (!mainSlot || candidate.perServing.kcal >= 150)
}

// ---------- a virtual pantry that the plan eats into ----------

interface Lot {
  grams: number
  expiresOn: string
}
type Stock = Map<number, Lot[]>

function buildStock(pantry: PantryItem[], byId: Map<number, Ingredient>): Stock {
  const stock: Stock = new Map()
  for (const p of pantry) {
    const food = byId.get(p.ingredientId)
    const grams = food ? toGrams(p.qty, p.unit, food) : null
    if (!grams || grams <= 0) continue
    stock.set(p.ingredientId, [...(stock.get(p.ingredientId) ?? []), { grams, expiresOn: p.expiresOn }])
  }
  for (const lots of stock.values()) lots.sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
  return stock
}

/** Grams that will still be good on `date`. */
const availableOn = (stock: Stock, id: number, date: string) =>
  (stock.get(id) ?? []).filter((l) => l.expiresOn >= date).reduce((s, l) => s + l.grams, 0)

/** Eat `grams` from what is good on `date`, using the food that expires soonest first. */
function consume(stock: Stock, id: number, grams: number, date: string) {
  let left = grams
  for (const lot of stock.get(id) ?? []) {
    if (left <= 0) break
    if (lot.expiresOn < date) continue
    const take = Math.min(lot.grams, left)
    lot.grams -= take
    left -= take
  }
}

const SOON_DAYS = 4
/** Worth about as much as a protein-rich meal: enough to break ties and nudge, never to beat food that is about to expire. */
export const FAMILIAR_BONUS = 0.8
export const LIKED_BONUS = 0.7
/** What a meal out is assumed to be worth, only for sizing the other meal of the day. It is not counted in your totals. */
export const EATING_OUT_KCAL = 700

interface Context {
  today: string
  byId: Map<number, Ingredient>
  stock: Stock
  /** Foods already needed by planned meals, so reusing them means less to buy. */
  plannedFoods: Set<number>
  /** The last date each recipe was planned. */
  lastUsed: Map<number, string>
  kcalTarget: number
  preferFamiliar: boolean
}

/** Lines of one meal's worth of a recipe, as grams. */
function mealLines(c: Candidate, byId: Map<number, Ingredient>) {
  const scale = (c.recipe.servingsPerMeal || 1) / c.recipe.servings
  const out: { food: Ingredient; grams: number }[] = []
  for (const line of c.recipe.ingredients) {
    const food = byId.get(line.ingredientId)
    if (!food || isStaple(food)) continue
    const grams = toGrams(line.qty * scale, line.unit, food)
    if (grams != null && grams > 0) out.push({ food, grams })
  }
  return out
}

function score(c: Candidate, date: string, dayKcal: number, slotsLeftToday: number, previousKinds: Set<KindId>, ctx: Context): number {
  const lines = mealLines(c, ctx.byId)
  let covered = 0
  let total = 0
  let reused = 0
  let expiring = 0
  for (const { food, grams } of lines) {
    const id = food.id!
    const avail = availableOn(ctx.stock, id, date)
    total += grams
    covered += Math.min(grams, avail)
    if (avail > 0 || ctx.plannedFoods.has(id)) reused++
    // food that is about to go off and will still be good on this day: using it earns the most
    const soon = (ctx.stock.get(id) ?? []).filter((l) => l.expiresOn >= date && l.grams > 0 && daysBetween(ctx.today, l.expiresOn) <= SOON_DAYS)
    if (soon.length > 0) {
      const lot = soon[0]
      const urgency = (SOON_DAYS + 1 - Math.max(0, daysBetween(ctx.today, lot.expiresOn))) / (SOON_DAYS + 1)
      expiring += urgency * (0.5 + 0.5 * Math.min(1, Math.min(grams, lot.grams) / lot.grams))
    }
  }
  const coverage = total > 0 ? covered / total : 0
  const reuse = lines.length > 0 ? reused / lines.length : 0
  const mealKcal = c.perServing.kcal * (c.recipe.servingsPerMeal || 1)
  const mealProtein = c.perServing.protein * (c.recipe.servingsPerMeal || 1)
  const ideal = Math.max(300, (ctx.kcalTarget - dayKcal) / Math.max(1, slotsLeftToday))

  const last = ctx.lastUsed.get(c.recipe.id)
  const repeat = last == null ? 0 : Math.abs(daysBetween(last, date)) <= 3 ? 3 : 0.8
  const sameKind = [...c.kinds].some((k) => k !== 'vegetarian' && previousKinds.has(k)) ? 0.6 : 0

  return (
    3 * Math.min(2, expiring) +
    1.5 * coverage +
    reuse +
    Math.min(1.2, mealProtein / 40) -
    0.8 * Math.min(1, Math.abs(mealKcal - ideal) / ideal) -
    repeat -
    sameKind -
    (c.warn ? 0.5 : 0) +
    (ctx.preferFamiliar && c.familiar ? FAMILIAR_BONUS : 0) +
    (c.liked ? LIKED_BONUS : 0)
  )
}

export interface SuggestInput {
  /** The dates to fill. */
  days: string[]
  /** The meals of the day to fill. */
  slots: MealSlot[]
  /** Meals already planned (in or around these days). They are kept, and count toward variety and the pantry. */
  existing: MealPlanEntry[]
  candidates: Candidate[]
  byId: Map<number, Ingredient>
  pantry: PantryItem[]
  today: string
  kcalTarget: number
  /** How many days cooked food keeps, which bounds how far a leftover can be from its cook. */
  leftoverDays: number
  /** Grocery trips. With none, any recipe may be chosen; with some, a meal must be makeable from the pantry or follow a trip. */
  trips?: Trip[]
  /** A recipe is "quick" at this many minutes or fewer. */
  quickMinutes?: number
  /** Lean towards everyday western dishes. */
  preferFamiliar?: boolean
  /** Meals to leave alone, as "date|slot" keys: today's meals whose time has already passed. */
  skipSlots?: string[]
  /** The meals in the order you eat them (see slotOrder), so a trip after a snack is placed where the snack is. */
  slotOrder?: MealSlot[]
}

/** A meal the planner could not fill, and why, in words you can act on. */
export interface Unresolved {
  date: string
  slot: MealSlot
  reason: string
}

export interface PlanResult {
  /** New meals for empty slots. */
  add: Omit<MealPlanEntry, 'id'>[]
  /** Meals you marked with a constraint (leftovers, quick, let the planner choose), now given a recipe. They keep the constraint. */
  update: { id: number; recipeId: number; servingsPlanned: number }[]
  unresolved: Unresolved[]
}

/** How many of this meal's foods the pantry (as eaten into so far) cannot cover. */
function missingFoods(c: Candidate, date: string, ctx: Context): number {
  let missing = 0
  for (const { food, grams } of mealLines(c, ctx.byId)) {
    if (grams - availableOn(ctx.stock, food.id!, date) > Math.max(2, grams * 0.02)) missing++
  }
  return missing
}

/**
 * Plans the empty slots in `days`, and the slots you gave a constraint:
 *  - leftovers: eats the most recent earlier cook. If nothing is planned the night before, cooks a big batch then.
 *  Nothing else is ever planned as leftovers: a meal you did not tag gets a recipe not planned within the leftover days.
 *  - quick: only recipes within `quickMinutes`.
 *  - any (let the planner choose): as an empty slot.
 *  - out: left alone, no food (counted as one assumed meal when sizing the day's other meal).
 * A meal you picked yourself is never changed. With grocery trips, a recipe is only chosen if the pantry covers it or a
 * trip comes first. Each pick favours food about to expire, pantry coverage, reuse, protein, calorie fit, and variety,
 * with a nudge towards familiar and liked recipes, and never a disliked one. Nothing is saved.
 */
export function planWeek(input: SuggestInput): PlanResult {
  const { days, slots, existing, candidates, byId, today, kcalTarget, leftoverDays } = input
  const quickMinutes = input.quickMinutes ?? 30
  const trips = upcomingTrips(input.trips ?? [], today)
  const stock = buildStock(input.pantry, byId)
  const byRecipe = new Map(candidates.map((c) => [c.recipe.id, c]))
  const usable = candidates.filter((c) => c.recipe.rating !== 'dislike')
  const ctx: Context = { today, byId, stock, plannedFoods: new Set(), lastUsed: new Map(), kcalTarget, preferFamiliar: input.preferFamiliar ?? false }

  // Meals you gave a constraint are planned afresh each time, so they are set aside from what is "already planned".
  const tasks = new Map<string, MealPlanEntry>()
  for (const e of existing) {
    if (e.status === 'planned' && e.constraint && e.constraint !== 'out' && days.includes(e.date)) tasks.set(mealKey(e.date, e.slot), e)
  }
  const fixed = existing.filter((e) => tasks.get(mealKey(e.date, e.slot)) !== e)

  // What the existing plan already uses up and needs.
  for (const s of cookSessions(fixed, leftoverDays)) {
    const c = byRecipe.get(s.recipeId)
    if (!c) continue
    const scale = s.servings / c.recipe.servings
    for (const line of c.recipe.ingredients) {
      const food = byId.get(line.ingredientId)
      if (!food || isStaple(food)) continue
      ctx.plannedFoods.add(food.id!)
      const g = toGrams(line.qty * scale, line.unit, food)
      if (g) consume(stock, food.id!, g, s.cookOn)
    }
  }
  for (const e of fixed) {
    if (e.status === 'skipped' || e.recipeId == null) continue
    const prev = ctx.lastUsed.get(e.recipeId)
    if (!prev || e.date > prev) ctx.lastUsed.set(e.recipeId, e.date)
  }

  const taken = new Set(fixed.map((e) => mealKey(e.date, e.slot)))
  const skip = new Set(input.skipSlots ?? [])
  const dayKcal = new Map<string, number>()
  for (const e of fixed) {
    if (e.status === 'skipped') continue
    const c = e.recipeId == null ? undefined : byRecipe.get(e.recipeId)
    if (c) dayKcal.set(e.date, (dayKcal.get(e.date) ?? 0) + c.perServing.kcal * e.servingsPlanned)
    else if (isFoodsMeal(e)) dayKcal.set(e.date, (dayKcal.get(e.date) ?? 0) + mealNutrition(e, new Map(), byId).kcal)
    else if (e.constraint === 'out' && e.status === 'planned') dayKcal.set(e.date, (dayKcal.get(e.date) ?? 0) + EATING_OUT_KCAL)
  }

  const order = [...slots].sort((a, b) => SLOT_ORDER.indexOf(a) - SLOT_ORDER.indexOf(b))
  const result: PlanResult = { add: [], update: [], unresolved: [] }
  // Every meal so far, yours and the planner's, so variety can look at what came just before a slot.
  const meals: { date: string; slot: MealSlot; kinds: Set<KindId> }[] = fixed
    .filter((e) => e.status !== 'skipped')
    .map((e) => ({ date: e.date, slot: e.slot, kinds: (e.recipeId == null ? undefined : byRecipe.get(e.recipeId))?.kinds ?? new Set<KindId>() }))
  const kindsBefore = (date: string, slot: MealSlot): Set<KindId> => {
    let best: (typeof meals)[number] | undefined
    for (const m of meals) if (byDateThenSlot(m, { date, slot }) < 0 && (!best || byDateThenSlot(m, best) > 0)) best = m
    return best?.kinds ?? new Set<KindId>()
  }
  // Every meal that has a recipe, for finding what a leftover meal can be eaten from.
  const cooked: { date: string; slot: MealSlot; recipeId: number; servings: number }[] = fixed
    .filter((e) => e.status === 'planned' && e.recipeId != null)
    .map((e) => ({ date: e.date, slot: e.slot, recipeId: e.recipeId!, servings: e.servingsPlanned }))
  /** Is this recipe already planned within the leftover window of a day? Planning it again would make one of the meals leftovers. */
  const plannedNear = (recipeId: number, date: string) => cooked.some((m) => m.recipeId === recipeId && Math.abs(daysBetween(m.date, date)) <= leftoverDays)
  const sourceFor = (date: string, slot: MealSlot) => {
    let best: (typeof cooked)[number] | undefined
    for (const m of cooked) {
      if (byDateThenSlot(m, { date, slot }) >= 0 || daysBetween(m.date, date) > leftoverDays) continue
      if (!best || byDateThenSlot(m, best) > 0) best = m
    }
    return best
  }

  type Why = 'none' | 'quick' | 'repeat' | 'trips'
  const why: Record<Why, string> = {
    none: 'No recipe suits this meal.',
    quick: `No recipe takes ${quickMinutes} minutes or less.`,
    repeat: `Every recipe you can cook is already planned within ${leftoverDays} ${leftoverDays === 1 ? 'day' : 'days'}, so this meal would be leftovers. Tag it as leftovers if that is what you want, or add more recipes.`,
    trips: 'Nothing you can make from your pantry before a grocery trip.',
  }

  /** The best recipe for a slot, or the reason there is none. Uses up the pantry food it needs. */
  const pickFresh = (
    date: string,
    slot: MealSlot,
    eaten: number,
    slotsLeft: number,
    { quick = false, batch = false }: { quick?: boolean; batch?: boolean } = {},
  ): { pick: Candidate } | { why: Why } => {
    let pool = usable.filter((c) => suitsSlot(c, slot))
    if (pool.length === 0) return { why: 'none' }
    if (quick) pool = pool.filter((c) => c.recipe.estMinutes <= quickMinutes)
    if (pool.length === 0) return { why: 'quick' }
    // a meal you did not tag as leftovers is never leftovers; the cook for a tagged leftovers meal (batch) is meant to be shared
    if (!batch) pool = pool.filter((c) => !plannedNear(c.recipe.id, date))
    if (pool.length === 0) return { why: 'repeat' }
    if (trips.length > 0) {
      const tripFirst = trips.some((t) => tripBefore(t, date, slot, input.slotOrder))
      pool = pool.filter((c) => tripFirst || missingFoods(c, date, ctx) === 0)
    }
    if (pool.length === 0) return { why: 'trips' }
    if (batch) {
      const big = pool.filter((c) => c.recipe.servings >= 2 * (c.recipe.servingsPerMeal || 1))
      if (big.length > 0) pool = big
    }
    let pick: Candidate | undefined
    let best = -Infinity
    for (const c of pool) {
      const s = score(c, date, eaten, slotsLeft, kindsBefore(date, slot), ctx)
      if (s > best || (s === best && pick && c.recipe.title < pick.recipe.title)) {
        best = s
        pick = c
      }
    }
    // the fresh cook uses up pantry food and needs its foods bought
    for (const { food, grams } of mealLines(pick!, byId)) {
      ctx.plannedFoods.add(food.id!)
      consume(stock, food.id!, grams, date)
    }
    return { pick: pick! }
  }

  /** Records a meal: as an update if you had marked the slot with a constraint, otherwise as a new meal. */
  const place = (date: string, slot: MealSlot, recipeId: number, servings: number, c: Candidate | undefined, eaten: number) => {
    const task = tasks.get(mealKey(date, slot))
    if (task) result.update.push({ id: task.id!, recipeId, servingsPlanned: servings })
    else result.add.push({ date, slot, recipeId, servingsPlanned: servings, status: 'planned' })
    ctx.lastUsed.set(recipeId, date)
    dayKcal.set(date, eaten + (c ? c.perServing.kcal * servings : 0))
    meals.push({ date, slot, kinds: c?.kinds ?? new Set<KindId>() })
    cooked.push({ date, slot, recipeId, servings })
  }

  for (const date of [...days].sort()) {
    const todaySlots = SLOT_ORDER.filter((s) => !taken.has(mealKey(date, s)) && !skip.has(mealKey(date, s)) && (order.includes(s) || tasks.has(mealKey(date, s))))
    for (const slot of todaySlots) {
      const slotsLeftToday = todaySlots.length - todaySlots.indexOf(slot)
      const eaten = dayKcal.get(date) ?? 0
      const constraint = tasks.get(mealKey(date, slot))?.constraint ?? 'any'
      const giveUp = (reason: string) => result.unresolved.push({ date, slot, reason })

      if (constraint === 'leftovers') {
        let source = sourceFor(date, slot)
        if (!source) {
          // Nothing cooked yet to reheat: cook a big batch the night before, if that dinner is free and not already past.
          const eve = addDays(date, -1)
          const eveKey = mealKey(eve, 'dinner')
          const eveEntry = fixed.find((e) => e.date === eve && e.slot === 'dinner')
          if (eveEntry?.constraint === 'out' && eveEntry.status === 'planned') {
            giveUp('You are eating out the night before, so there is nothing to eat as leftovers.')
            continue
          }
          if (eve < today || taken.has(eveKey) || tasks.has(eveKey)) {
            giveUp('There is no dinner the night before to make leftovers from.')
            continue
          }
          const made = pickFresh(eve, 'dinner', dayKcal.get(eve) ?? 0, 1, { batch: true })
          if ('why' in made) {
            giveUp(`Could not plan a dinner the night before to make leftovers from. ${why[made.why]}`)
            continue
          }
          const servings = made.pick.recipe.servingsPerMeal || 1
          result.add.push({ date: eve, slot: 'dinner', recipeId: made.pick.recipe.id, servingsPlanned: servings, status: 'planned' })
          ctx.lastUsed.set(made.pick.recipe.id, eve)
          dayKcal.set(eve, (dayKcal.get(eve) ?? 0) + made.pick.perServing.kcal * servings)
          meals.push({ date: eve, slot: 'dinner', kinds: made.pick.kinds })
          cooked.push({ date: eve, slot: 'dinner', recipeId: made.pick.recipe.id, servings })
          source = sourceFor(date, slot)
        }
        if (!source) {
          giveUp('There is no dinner the night before to make leftovers from.')
          continue
        }
        const own = byRecipe.get(source.recipeId)
        place(date, slot, source.recipeId, own?.recipe.servingsPerMeal || source.servings, own, eaten)
        continue
      }

      // Only a meal you tagged as leftovers is leftovers. Everything else is cooked fresh.
      const found = pickFresh(date, slot, eaten, slotsLeftToday, { quick: constraint === 'quick' })
      if ('why' in found) {
        giveUp(why[found.why])
        continue
      }
      place(date, slot, found.pick.recipe.id, found.pick.recipe.servingsPerMeal || 1, found.pick, eaten)
    }
  }
  return result
}

/** Just the new meals for empty slots (no constraints or trips), as a plain list. */
export function suggestPlan(input: SuggestInput): Omit<MealPlanEntry, 'id'>[] {
  return planWeek(input).add
}
