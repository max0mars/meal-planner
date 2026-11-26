import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from '../api/liveQuery'
import { Apple, CalendarDays, Check, ChefHat, ShoppingBasket, TriangleAlert } from 'lucide-react'
import FoodsSheet from '../components/FoodsSheet'
import TimeSelect from '../components/TimeSelect'
import { db } from '../db'
import { backTo } from '../lib/backTo'
import { daysLeft, expiryLabel, expiryStatus, todayIso } from '../lib/pantry'
import { pantryMatch, pantryScore } from '../lib/pantryMatch'
import {
  CONSTRAINT_LABEL,
  SLOT_LABEL,
  cookSessions,
  dayTotals,
  foodsAsRecipe,
  foodsTitle,
  isFoodsMeal,
  isLeftover,
  mealNutrition,
  type PerServing,
} from '../lib/plan'
import { suitsSlot, type Candidate } from '../lib/planner'
import { markMade, removeMeal, setEatingOut, setFoods, setTimes, unmarkMade, updateFoods } from '../lib/planEdit'
import { formatServings } from '../lib/scaling'
import { assignToTrips, buildShoppingList, missingWithNoTrip } from '../lib/shopping'
import { formatTime, slotOrder } from '../lib/times'
import { itemsToUseSoon, todaysMeals } from '../lib/today'
import { tripPosition } from '../lib/trips'
import { useRecipeRows } from '../lib/useRecipeRows'
import type { MealPlanEntry, MealSlot } from '../types'

const longDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })

/** What to cook and eat today, how it adds up against your targets, what in the pantry to use soon, and any grocery trip. */
export default function Today() {
  const kitchen = useRecipeRows()
  const entries = useLiveQuery(() => db.mealPlan.toArray(), [])
  const pantry = useLiveQuery(() => db.pantryItems.toArray(), [])
  const trips = useLiveQuery(() => db.trips.toArray(), [])
  // the time, refreshed each minute so "Up next" moves on while the screen is open
  const [now, setNow] = useState(() => new Date())
  // the meal you are adding plain foods to (or whose foods you are changing), and whether its time has come (so it is
  // likely already eaten)
  const [foodsFor, setFoodsFor] = useState<{ slot: MealSlot; eaten: boolean; entry?: MealPlanEntry } | null>(null)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const today = todayIso(now)
  const settings = kitchen?.data.settings

  const perServing = useMemo(
    () => new Map<number, PerServing>((kitchen?.rows ?? []).map((r) => [r.recipe.id, { kcal: r.nutrition.kcalPerServing, protein: r.nutrition.proteinPerServing }])),
    [kitchen],
  )
  const sessions = useMemo(() => cookSessions(entries ?? [], settings?.leftoverShelfLifeDays ?? 4), [entries, settings])

  // how many things to buy on each trip, and what is missing with no trip to bring it in time
  const { perTrip, missing } = useMemo(() => {
    if (!kitchen || !entries || !pantry || !trips || !settings) return { perTrip: new Map<number, number>(), missing: [] }
    const upcoming = cookSessions(entries.filter((e) => e.date >= today), settings.leftoverShelfLifeDays)
    const list = buildShoppingList(upcoming, new Map(kitchen.rows.map((r) => [r.recipe.id, r.recipe])), kitchen.data.byId, pantry.filter((p) => p.expiresOn >= today))
    const byTrip = assignToTrips(list.toBuy, trips, today, slotOrder(settings.mealTimes))
    return {
      perTrip: new Map((byTrip?.groups ?? []).map((g) => [g.trip.id!, g.items.length])),
      missing: missingWithNoTrip(list.toBuy, byTrip),
    }
  }, [kitchen, entries, pantry, trips, today, settings])

  // meals that would use up the food that is about to go off, best first
  const ideas = useMemo(() => {
    if (!kitchen || !pantry) return []
    const byId = kitchen.data.byId
    return kitchen.rows
      .filter((r) => r.safety.status !== 'excluded' && r.recipe.rating !== 'dislike')
      .filter((r) => suitsSlot({ recipe: r.recipe, perServing: { kcal: r.nutrition.kcalPerServing, protein: r.nutrition.proteinPerServing } } as Candidate, 'dinner'))
      .map((r) => {
        const match = pantryMatch(r.recipe, pantry, byId, today, today)
        return { row: r, match, score: pantryScore(match) }
      })
      .filter((x): x is { row: (typeof kitchen.rows)[number]; match: ReturnType<typeof pantryMatch>; score: number } => x.score != null && x.match.soon.length > 0)
      .sort((a, b) => b.score - a.score || a.row.recipe.title.localeCompare(b.row.recipe.title))
      .slice(0, 3)
  }, [kitchen, pantry, today])

  if (!kitchen || !entries || !pantry || !trips || !settings) return <p className="muted">Loading…</p>

  const meals = todaysMeals(entries, today, settings.planSlots ?? ['lunch', 'dinner'], settings.mealTimes, now.getHours() * 60 + now.getMinutes())
  const totals = dayTotals(entries, today, perServing, kitchen.data.byId)
  const planned = meals.filter((m) => m.entry).length
  const soon = itemsToUseSoon(pantry, today)
  const todaysTrips = trips.filter((t) => t.date === today).sort((a, b) => a.time.localeCompare(b.time))
  const order = slotOrder(settings.mealTimes)
  const format = settings.timeFormat

  const share = (value: number, target: number) => Math.min(1, target > 0 ? value / target : 0)

  // "Made it" (or "Ate it") and Undo, under any meal you can make or eat
  const madeControls = (entry: MealPlanEntry, made: boolean, label: string, takes?: Parameters<typeof markMade>[1]) =>
    entry.id == null ? null : made ? (
      <>
        {entry.usedPantry && entry.usedPantry.length > 0 && (
          <span className="today-cook">
            Taken from your pantry: {[...new Set(entry.usedPantry.map((u) => kitchen.data.byId.get(u.before.ingredientId)?.name).filter(Boolean))].join(', ')}
          </span>
        )}
        <button type="button" className="btn-quiet today-undo" onClick={() => unmarkMade(entry.id!)}>
          Undo
        </button>
      </>
    ) : (
      <button type="button" className="btn-outline today-made" onClick={() => markMade(entry.id!, takes)}>
        <Check size={20} aria-hidden /> {label}
      </button>
    )

  // takes the meal off today; the recipe itself stays in your recipes. Not offered once made: Undo that first.
  const removeButton = (m: (typeof meals)[number]) =>
    m.entry?.id != null && !m.made ? (
      <button type="button" className="btn-quiet today-remove" aria-label={`Remove ${SLOT_LABEL[m.slot].toLowerCase()} from today`} onClick={() => removeMeal(m.entry!.id!)}>
        Remove
      </button>
    ) : null

  const addFoods = (m: (typeof meals)[number], replacing?: MealPlanEntry) => (
    <button type="button" className="btn-outline today-made" onClick={() => setFoodsFor({ slot: m.slot, eaten: m.state === 'past', entry: replacing })}>
      <Apple size={20} aria-hidden /> Add foods
    </button>
  )

  const mealCard = (m: (typeof meals)[number]) => {
    const { entry } = m
    const row = entry?.recipeId != null ? kitchen.recipeById.get(entry.recipeId) : undefined
    const leftover = !!entry && isLeftover(entry, sessions)
    const foodsMeal = isFoodsMeal(entry)
    const eatenNotMade = leftover || entry?.constraint === 'leftovers' || foodsMeal
    return (
      <li key={m.slot} className={`today-meal ${m.state}${m.made ? ' made' : ''}`}>
        <div className="today-when">
          {entry?.id != null ? (
            <TimeSelect className="today-time" label={`${SLOT_LABEL[m.slot]} time`} value={m.time} format={format} onChange={(v) => setTimes(entry.id!, { eatAt: v })} />
          ) : (
            <span className="today-time">{formatTime(m.time, format)}</span>
          )}
          <span className="today-slot">{SLOT_LABEL[m.slot]}</span>
          {m.made ? (
            <span className="today-tag made">
              <Check size={14} aria-hidden /> {eatenNotMade ? 'Eaten' : 'Made'}
            </span>
          ) : (
            <>
              {m.state === 'next' && <span className="today-tag next">Up next</span>}
              {m.state === 'past' && <span className="today-tag">Earlier</span>}
            </>
          )}
        </div>
        {entry && isFoodsMeal(entry) ? (
          <div className="today-body">
            <span className="today-title plain">{foodsTitle(entry.foods, kitchen.data.byId)}</span>
            <span className="r-nums">
              <span>{Math.round(mealNutrition(entry, perServing, kitchen.data.byId).kcal)} kcal</span>
              <span>{Math.round(mealNutrition(entry, perServing, kitchen.data.byId).protein)} g protein</span>
              {entry.borrowed && entry.borrowed.length > 0 && (
                <span>Borrowed: {entry.borrowed.map((id) => kitchen.data.byId.get(id)?.name).filter(Boolean).join(', ')}</span>
              )}
            </span>
            <span className="today-links">
              {madeControls(entry, m.made, 'Ate it', { recipe: foodsAsRecipe(entry.foods), servings: 1, byId: kitchen.data.byId, today })}
              {!m.made && (
                <button type="button" className="btn-quiet" onClick={() => setFoodsFor({ slot: m.slot, eaten: false, entry })}>
                  Edit foods
                </button>
              )}
              {removeButton(m)}
            </span>
          </div>
        ) : row && entry ? (
          <div className="today-body">
            <Link to={`/recipes/${row.recipe.id}`} state={backTo('/today', 'Today')} className="today-title">
              {row.recipe.title}
            </Link>
            <span className="r-nums">
              <span>{Math.round(row.nutrition.kcalPerServing * entry.servingsPlanned)} kcal</span>
              <span>{Math.round(row.nutrition.proteinPerServing * entry.servingsPlanned)} g protein</span>
              <span>
                {formatServings(entry.servingsPlanned)} {entry.servingsPlanned === 1 ? 'serving' : 'servings'}
              </span>
              {!eatenNotMade && <span>{row.recipe.estMinutes} min</span>}
            </span>
            {!m.made && eatenNotMade && <span className="today-cook">Leftovers, nothing to cook</span>}
            <span className="today-links">
              {madeControls(
                entry,
                m.made,
                eatenNotMade ? 'Ate it' : 'Made it',
                // leftovers take nothing from the pantry: that food went when they were cooked
                eatenNotMade
                  ? undefined
                  : {
                      recipe: row.recipe,
                      servings: sessions.find((s) => s.entries.some((e) => e.id === entry.id))?.servings ?? entry.servingsPlanned,
                      byId: kitchen.data.byId,
                      today,
                    },
              )}
              {removeButton(m)}
            </span>
          </div>
        ) : entry?.constraint === 'out' ? (
          <div className="today-body">
            <span className="today-title plain">Eating out</span>
            {entry.id != null && <EatingOutNumbers key={entry.id} id={entry.id} kcal={entry.outKcal} protein={entry.outProtein} />}
            <span className="today-links">{removeButton(m)}</span>
          </div>
        ) : entry?.constraint ? (
          <div className="today-body">
            <span className="today-title plain">{CONSTRAINT_LABEL[entry.constraint]}, not planned yet</span>
            <span className="today-links">
              <Link to="/plan" className="source-link">
                Choose a recipe on the plan
              </Link>
              {removeButton(m)}
            </span>
          </div>
        ) : entry ? (
          <div className="today-body">
            <span className="today-title plain muted">Recipe deleted</span>
            <span className="today-links">
              {addFoods(m, entry)}
              <Link to="/plan" className="source-link">
                Choose another recipe
              </Link>
              {removeButton(m)}
            </span>
          </div>
        ) : (
          <div className="today-body">
            <span className="today-title plain muted">Nothing planned</span>
            <span className="today-links">
              {addFoods(m)}
              <Link to="/plan" className="source-link">
                Plan a recipe
              </Link>
            </span>
          </div>
        )}
      </li>
    )
  }

  return (
    <section>
      <header className="page-head">
        <h1>Today</h1>
        <p className="summary">{longDate(today)}</p>
      </header>

      {missing.length > 0 && (
        <div className="today-warning" role="alert">
          <TriangleAlert size={24} aria-hidden />
          <div className="today-warning-body">
            <p className="today-warning-title">
              {missing.length} {missing.length === 1 ? 'ingredient' : 'ingredients'} missing and not scheduled in time
            </p>
            <p className="today-warning-names">
              {missing
                .slice(0, 4)
                .map((i) => i.food.name)
                .join(', ')}
              {missing.length > 4 ? ` and ${missing.length - 4} more` : ''}
            </p>
            <span className="today-warning-links">
              <Link to="/plan" className="source-link">
                Schedule groceries
              </Link>
              <Link to="/shopping" className="source-link">
                See the shopping list
              </Link>
            </span>
          </div>
        </div>
      )}

      <div className="today-totals" aria-label="Today against your targets">
        <div className="today-total">
          <span>
            <b>{Math.round(totals.kcal).toLocaleString()}</b> of {settings.kcalTarget.toLocaleString()} kcal
          </span>
          <span className="bar" aria-hidden>
            <span className="bar-fill" style={{ width: `${share(totals.kcal, settings.kcalTarget) * 100}%` }} />
          </span>
        </div>
        <div className="today-total">
          <span>
            <b>{Math.round(totals.protein)}</b> of {settings.proteinTarget} g protein
          </span>
          <span className="bar" aria-hidden>
            <span className="bar-fill" style={{ width: `${share(totals.protein, settings.proteinTarget) * 100}%` }} />
          </span>
        </div>
      </div>

      <div className="block-head">
        <h2>Meals</h2>
        {planned === 0 && <p>Nothing is planned for today yet.</p>}
      </div>
      {meals.length > 0 ? (
        <ul className="today-list">{meals.map(mealCard)}</ul>
      ) : (
        <p className="hint">You have no meals turned on. Choose them in Settings.</p>
      )}
      {planned === 0 && (
        <Link to="/plan" className="btn-primary today-cta">
          <CalendarDays size={20} aria-hidden /> Plan today
        </Link>
      )}

      {todaysTrips.length > 0 && (
        <>
          <div className="block-head">
            <h2>Groceries today</h2>
          </div>
          <ul className="today-list">
            {todaysTrips.map((t) => {
              const count = t.id != null ? perTrip.get(t.id) : undefined
              return (
                <li key={t.id} className="today-trip">
                  <ShoppingBasket size={20} aria-hidden />
                  <span className="today-body">
                    <span className="today-title plain">
                      {t.id != null ? (
                        <TimeSelect className="today-time" label="Grocery trip time" value={t.time} format={format} onChange={(v) => db.trips.update(t.id!, { time: v })} />
                      ) : (
                        formatTime(t.time, format)
                      )}
                      , {tripPosition(t.after, settings.planSlots ?? ['lunch', 'dinner'], order)}
                    </span>
                    {t.note && <span className="hint">{t.note}</span>}
                    <Link to="/shopping" className="source-link">
                      {count ? `See the ${count} ${count === 1 ? 'thing' : 'things'} to buy` : 'Open the shopping list'}
                    </Link>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div className="block-head">
        <h2>Use soon</h2>
        <p>Food that is past its date or goes off in the next few days.</p>
      </div>
      {soon.length === 0 ? (
        <p className="hint">Nothing in your pantry is about to go off.</p>
      ) : (
        <ul className="today-list">
          {soon.map((item) => {
            const food = kitchen.data.byId.get(item.ingredientId)
            const days = daysLeft(item.expiresOn, today)
            const { value, caption } = expiryLabel(days)
            return (
              <li key={item.id} className={`today-soon ${expiryStatus(days)}`}>
                <span className="today-soon-name">
                  {food?.name ?? 'Unknown food'}
                  <span className="hint">
                    {item.qty} {item.unit}
                  </span>
                </span>
                <span className="today-soon-days">
                  <b>{value}</b> {caption}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <Link to="/pantry" className="source-link">
        Open the pantry
      </Link>

      {ideas.length > 0 && (
        <>
          <div className="block-head">
            <h2>Cook with it</h2>
            <p>Meals that use up some of it.</p>
          </div>
          <ul className="today-list">
            {ideas.map(({ row, match }) => (
              <li key={row.recipe.id} className="today-idea">
                <ChefHat size={20} aria-hidden />
                <span className="today-body">
                  <Link to={`/recipes/${row.recipe.id}`} state={backTo('/today', 'Today')} className="today-title">
                    {row.recipe.title}
                  </Link>
                  <span className="pick-note soon">Uses up {match.soon.join(', ').toLowerCase()}</span>
                  <span className="pick-note">{match.missing.length === 0 ? 'You have everything' : `Missing ${match.missing.join(', ').toLowerCase()}`}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {foodsFor && (
        <FoodsSheet
          title={`${SLOT_LABEL[foodsFor.slot]}, today`}
          ingredients={kitchen.data.ingredients}
          initial={isFoodsMeal(foodsFor.entry) ? { foods: foodsFor.entry.foods, borrowed: foodsFor.entry.borrowed } : undefined}
          eatenOption={!isFoodsMeal(foodsFor.entry)}
          eatenByDefault={foodsFor.eaten}
          onSave={async (foods, eaten, borrowed) => {
            if (isFoodsMeal(foodsFor.entry) && foodsFor.entry.id != null) {
              await updateFoods(foodsFor.entry.id, foods, borrowed)
            } else {
              const id = await setFoods(today, foodsFor.slot, foods, borrowed)
              if (eaten) await markMade(id, { recipe: foodsAsRecipe(foods), servings: 1, byId: kitchen.data.byId, today })
            }
            setFoodsFor(null)
          }}
          onClose={() => setFoodsFor(null)}
        />
      )}
    </section>
  )
}

/**
 * Calories and protein for a meal out, typed in. Each is saved as you type, and an empty box means "not known", which
 * counts as nothing towards the day.
 */
function EatingOutNumbers({ id, kcal, protein }: { id: number; kcal?: number; protein?: number }) {
  const [values, setValues] = useState({ kcal: kcal == null ? '' : String(kcal), protein: protein == null ? '' : String(protein) })
  const save = (next: typeof values) => {
    setValues(next)
    const num = (v: string) => (v.trim() !== '' && Number(v) >= 0 ? Number(v) : undefined)
    setEatingOut(id, { kcal: num(next.kcal), protein: num(next.protein) })
  }
  return (
    <span className="out-numbers">
      <label>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="?"
          aria-label="Calories eating out"
          value={values.kcal}
          onChange={(e) => save({ ...values, kcal: e.target.value })}
        />{' '}
        kcal
      </label>
      <label>
        <input
          className="input"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="?"
          aria-label="Protein eating out"
          value={values.protein}
          onChange={(e) => save({ ...values, protein: e.target.value })}
        />{' '}
        g protein
      </label>
    </span>
  )
}
