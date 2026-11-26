import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from '../api/liveQuery'
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Plus, ShoppingBasket, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react'
import FoodsSheet from '../components/FoodsSheet'
import RecipePicker from '../components/RecipePicker'
import SlotSheet from '../components/SlotSheet'
import TripSheet from '../components/TripSheet'
import { db } from '../db'
import { buildCalendar, calendarEvents, calendarFileName, type CalendarInput } from '../lib/ics'
import { downloadTextFile } from '../lib/download'
import { addDays, daysBetween } from '../lib/expiry'
import { formatDate, todayIso } from '../lib/pantry'
import {
  CONSTRAINT_LABEL,
  SLOT_LABEL,
  SLOT_ORDER,
  cookSessions,
  dayTotals,
  foodsTitle,
  isFoodsMeal,
  isLeftover,
  mealNutrition,
  weekDays,
  type PerServing,
} from '../lib/plan'
import { applyPlan, clearDays, dismissCookDeleted, removeMeal, removeTrip, saveTrip, setConstraint, setFoods, setMeal, updateFoods } from '../lib/planEdit'
import { planWeek, type Unresolved } from '../lib/planner'
import { assignToTrips, buildShoppingList, formatBuy, mealShortfalls } from '../lib/shopping'
import { defaultTripTime, eatTime, formatTime, passedSlots, slotOrder, toMinutes } from '../lib/times'
import { tripPosition, type TripAfter } from '../lib/trips'
import { useRecipeRows } from '../lib/useRecipeRows'
import type { MealPlanEntry, MealSlot, SlotConstraint } from '../types'

const QUICK_KINDS: SlotConstraint[] = ['leftovers', 'out', 'quick']

const DAYS_SHOWN = 3
/** The day strip scrolls: this many days before today, and this many after (it grows as you near the end). */
const PAST_DAYS = 7
const FUTURE_DAYS = 28
/** The spring's smoothing time for the arrow slide, in seconds. Lower is quicker; one day takes roughly three times this. */
const SLIDE_SECONDS = 0.06

/** Pixels from the left edge of one day to the left edge of the next, or 0 before the strip has a layout. */
const dayStep = (strip: HTMLElement) =>
  strip.children.length > 1 ? (strip.children[1] as HTMLElement).offsetLeft - (strip.children[0] as HTMLElement).offsetLeft : 0
const PLAN_DAYS = DAYS_SHOWN

type Sheet =
  | { kind: 'slot'; date: string; slot: MealSlot }
  | { kind: 'pick'; date: string; slot: MealSlot }
  | { kind: 'foods'; date: string; slot: MealSlot }
  | { kind: 'trip'; date: string; after: TripAfter }

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
const dayNumber = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

export default function Plan() {
  const kitchen = useRecipeRows()
  const entries = useLiveQuery(() => db.mealPlan.toArray(), [])
  const pantry = useLiveQuery(() => db.pantryItems.toArray(), [])
  const trips = useLiveQuery(() => db.trips.toArray(), [])
  const today = todayIso()
  const [start, setStart] = useState(today)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [note, setNote] = useState('')
  const [unresolved, setUnresolved] = useState<Unresolved[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  // the day whose clear button was tapped and now asks to be sure
  const [confirmDay, setConfirmDay] = useState<string | null>(null)

  // the three days on screen, and every day in the strip you can scroll through
  const days = useMemo(() => weekDays(start, DAYS_SHOWN), [start])
  const stripStart = addDays(today, -PAST_DAYS)
  // days after today in the strip: more appear, a month at a time, as you near the end
  const future = Math.max(FUTURE_DAYS, Math.ceil((daysBetween(stripStart, start) + DAYS_SHOWN + 10 - PAST_DAYS) / FUTURE_DAYS) * FUTURE_DAYS)
  const stripDays = useMemo(() => weekDays(stripStart, PAST_DAYS + future), [stripStart, future])
  const strip = useRef<HTMLDivElement>(null)
  const placed = useRef(false)
  const goal = useRef(0) // where a slide is heading, in pixels
  const frame = useRef(0) // the running slide's animation frame, or 0
  const settings = kitchen?.data.settings
  const perServing = useMemo(
    () => new Map<number, PerServing>((kitchen?.rows ?? []).map((r) => [r.recipe.id, { kcal: r.nutrition.kcalPerServing, protein: r.nutrition.proteinPerServing }])),
    [kitchen],
  )
  const sessions = useMemo(() => cookSessions(entries ?? [], settings?.leftoverShelfLifeDays ?? 4), [entries, settings])

  // what the plan from today on still needs bought, and how much of it falls on each trip
  const shopping = useMemo(() => {
    if (!kitchen || !entries || !pantry || !trips || !settings) return null
    const upcoming = cookSessions(entries.filter((e) => e.date >= today), settings.leftoverShelfLifeDays)
    const list = buildShoppingList(upcoming, new Map(kitchen.rows.map((r) => [r.recipe.id, r.recipe])), kitchen.data.byId, pantry.filter((p) => p.expiresOn >= today))
    const byTrip = assignToTrips(list.toBuy, trips, today, slotOrder(settings.mealTimes))
    return {
      total: list.toBuy.length,
      // meals short of food that no scheduled trip brings in time, by `date|slot`
      short: mealShortfalls(list.toBuy, trips, today, slotOrder(settings.mealTimes)),
      perTrip: new Map((byTrip?.groups ?? []).map((g) => [g.trip.id!, g.items.length])),
      // what to buy on each trip, as lines for the calendar event
      lines: new Map((byTrip?.groups ?? []).map((g) => [g.trip.id!, g.items.map((i) => `${i.food.name} ${formatBuy(i.food, i.buyGrams, i.allPieces)}`)])),
    }
  }, [kitchen, entries, pantry, trips, today, settings])

  const ready = !!(kitchen && entries && pantry && trips && settings && shopping)

  // Keep the strip on `start`: jump there the first time, then slide. A swipe settles on a day, which sets `start` to match.
  // The slide keeps chasing the latest target, so tapping an arrow again and again runs on as one smooth movement instead of
  // restarting each time. It always plays, even if the system asks for less motion: it is short and only runs on a tap.
  useEffect(() => {
    const el = strip.current
    if (!el) return
    const step = dayStep(el)
    if (step <= 0) return
    const left = Math.max(0, daysBetween(stripStart, start)) * step
    if (!placed.current) {
      el.scrollLeft = left
      placed.current = true
      return
    }
    goal.current = left
    if (frame.current !== 0 || Math.abs(el.scrollLeft - left) < 2) return // already on its way, or already there
    el.style.scrollSnapType = 'none' // snapping would fight the slide
    // A critically damped spring toward the goal: speed builds up and eases off with no jolt, and a new goal in the middle of
    // a slide just bends the movement, so tapping repeatedly glides instead of stuttering.
    let pos = el.scrollLeft
    let speed = 0
    let last = 0
    const omega = 2 / SLIDE_SECONDS
    const tick = (now: number) => {
      const dt = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000) // the first frame has no earlier one to measure from
      last = now
      const x = omega * dt
      const damp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
      const off = pos - goal.current
      const carry = (speed + omega * off) * dt
      speed = (speed - omega * carry) * damp
      pos = goal.current + (off + carry) * damp
      if (Math.abs(pos - goal.current) < 1.5 && Math.abs(speed) < 60) {
        el.scrollLeft = goal.current
        el.style.scrollSnapType = ''
        frame.current = 0
        return
      }
      el.scrollLeft = pos
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }, [start, stripStart, ready])

  useEffect(() => {
    const el = strip.current
    if (!el) return
    let timer = 0
    const settle = () => {
      const step = dayStep(el)
      // while a slide is running, `start` is already where it is heading
      if (step > 0 && frame.current === 0) setStart(addDays(stripStart, Math.max(0, Math.round(el.scrollLeft / step))))
    }
    const onScroll = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(settle, 120)
    }
    // putting a finger or wheel on the strip takes over from a slide
    const takeOver = () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      el.style.scrollSnapType = ''
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('touchstart', takeOver, { passive: true })
    el.addEventListener('wheel', takeOver, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('touchstart', takeOver)
      el.removeEventListener('wheel', takeOver)
      window.clearTimeout(timer)
      takeOver()
    }
  }, [ready, stripStart])

  // the clear-day question closes by itself after a few seconds, so it never stays armed
  useEffect(() => {
    if (confirmDay === null) return
    const timer = window.setTimeout(() => setConfirmDay(null), 5000)
    return () => window.clearTimeout(timer)
  }, [confirmDay])

  if (!kitchen || !entries || !pantry || !trips || !settings || !shopping) return <p className="muted">Loading…</p>

  const planSlots = settings.planSlots ?? ['lunch', 'dinner']
  const slotsFor = (date: string): MealSlot[] => {
    const used = entries.filter((e) => e.date === date).map((e) => e.slot)
    // in the order you eat them that day: by the time set on the meal if it has one, otherwise your usual time for it
    const at = (s: MealSlot) => {
      const e = entries.find((x) => x.date === date && x.slot === s)
      return toMinutes(e ? eatTime(e, settings.mealTimes) : settings.mealTimes[s])
    }
    return SLOT_ORDER.filter((s) => planSlots.includes(s) || used.includes(s)).sort((x, y) => at(x) - at(y) || SLOT_ORDER.indexOf(x) - SLOT_ORDER.indexOf(y))
  }
  const entryAt = (date: string, slot: MealSlot) => entries.find((e) => e.date === date && e.slot === slot)
  const tripAt = (date: string, after: TripAfter) => trips.find((t) => t.date === date && t.after === after)

  /** Fills the empty meals of these days (from today on) with recipes, and says what it did. */
  const planDays = async (days: string[]) => {
    setConfirmClear(false)
    const result = planWeek({
      days,
      slots: planSlots,
      existing: entries,
      candidates: kitchen.candidates,
      byId: kitchen.data.byId,
      pantry: pantry.filter((p) => p.expiresOn >= today),
      today,
      kcalTarget: settings.kcalTarget,
      leftoverDays: settings.leftoverShelfLifeDays,
      trips,
      quickMinutes: settings.quickMinutes,
      preferFamiliar: settings.preferFamiliar,
      skipSlots: passedSlots(today, new Date(), planSlots, settings.mealTimes),
      slotOrder: slotOrder(settings.mealTimes),
    })
    await applyPlan(result)
    setUnresolved(result.unresolved)
    const filled = result.add.length + result.update.length
    const span = days.length === 1 ? formatDate(days[0]) : `${formatDate(days[0])} to ${formatDate(days[days.length - 1])}`
    const these = days.length === 1 ? 'this day' : `these ${days.length} days`
    if (kitchen.candidates.length === 0) setNote('There are no recipes you can cook yet. Add some on the Recipes screen.')
    else if (filled === 0 && result.unresolved.length === 0) setNote(`Nothing to add: every meal in ${these} is already planned.`)
    else setNote(`Planned ${filled} ${filled === 1 ? 'meal' : 'meals'} for ${span}.${result.unresolved.length > 0 ? ` ${result.unresolved.length} could not be planned.` : ''}`)
  }
  const planMyWeek = () => {
    const from = start < today ? today : start
    return planDays(weekDays(from, PLAN_DAYS))
  }

  // clearing empties the days of their meals and their grocery trips
  const clearThreeDays = async () => {
    await clearDays(days)
    setConfirmClear(false)
  }
  const clearOneDay = async (date: string) => {
    await clearDays([date])
    setConfirmDay(null)
  }
  const hasPlan = (date: string) => entries.some((e) => e.date === date && e.status === 'planned') || trips.some((t) => t.date === date)

  /** Everything planned from today on, as a calendar file you can import into Google Calendar. Nothing is connected or sent. */
  const exportCalendar = () => {
    const input: CalendarInput = {
      entries,
      trips,
      recipes: new Map(kitchen.rows.map((r) => [r.recipe.id, { title: r.recipe.title, estMinutes: r.recipe.estMinutes, source: r.recipe.source }])),
      sessions: cookSessions(entries.filter((e) => e.date >= today), settings.leftoverShelfLifeDays),
      mealTimes: settings.mealTimes,
      shopping: shopping.lines,
      from: today,
    }
    const count = calendarEvents(input).length
    if (count === 0) {
      setNote('Nothing to add to a calendar yet. Plan some meals or add a grocery trip first.')
      return
    }
    downloadTextFile(calendarFileName(today), buildCalendar(input), 'text/calendar')
    setNote(`Saved ${calendarFileName(today)} with ${count} ${count === 1 ? 'event' : 'events'}: meals and grocery trips from today on. Open it to add them to your calendar.`)
  }

  const open = sheet?.kind === 'slot' ? sheet : null
  const picking = sheet?.kind === 'pick' ? sheet : null
  const choosingFoods = sheet?.kind === 'foods' ? sheet : null
  const openTrip = sheet?.kind === 'trip' ? sheet : null

  const tripButton = (date: string, after: TripAfter) => {
    const trip = tripAt(date, after)
    const count = trip?.id != null ? shopping.perTrip.get(trip.id) : undefined
    const where = tripPosition(after, planSlots, slotOrder(settings.mealTimes))
    const button = (
      <button
        type="button"
        className={`plan-trip${trip ? ' set' : ''}`}
        aria-label={trip ? `Groceries ${weekday(date)} ${where}, at ${formatTime(trip.time, settings.timeFormat)}. Change` : `Add groceries ${weekday(date)} ${where}`}
        // no trip yet: tapping adds one at the usual time; tapping a trip that is there opens it to change
        onClick={() => (trip ? setSheet({ kind: 'trip', date, after }) : saveTrip({ date, after, time: defaultTripTime(after, planSlots, settings.mealTimes) }))}
      >
        {trip ? (
          <>
            <ShoppingBasket size={14} aria-hidden /> {formatTime(trip.time, settings.timeFormat)}
            {count ? <span className="trip-count">{count}</span> : null}
          </>
        ) : (
          <>
            <Plus size={14} aria-hidden /> Groceries
          </>
        )}
      </button>
    )
    if (trip?.id == null) return button
    const tripId = trip.id
    return (
      <div className="trip-wrap">
        {button}
        <button type="button" className="trip-x" aria-label={`Remove groceries ${weekday(date)} ${where}`} onClick={() => removeTrip(tripId)}>
          <X size={16} aria-hidden />
        </button>
      </div>
    )
  }

  const cell = (date: string, slot: MealSlot) => {
    const entry = entryAt(date, slot)
    const row = entry?.recipeId != null ? kitchen.recipeById.get(entry.recipeId) : undefined
    const leftover = !!entry && isLeftover(entry, sessions)
    const label = SLOT_LABEL[slot]
    const foods = isFoodsMeal(entry) ? { title: foodsTitle(entry.foods, kitchen.data.byId), kcal: mealNutrition(entry, perServing, kitchen.data.byId).kcal } : null
    let kind = 'open'
    let aria = `Add ${label.toLowerCase()}, ${weekday(date)}`
    if (foods) {
      kind = 'recipe foods'
      aria = `${label}, ${weekday(date)}: ${foods.title}, ${Math.round(foods.kcal)} kcal`
    } else if (entry?.constraint === 'out') {
      kind = 'out'
      aria = `${label}, ${weekday(date)}: eating out`
    } else if (row && entry) {
      kind = row.safety.status === 'warn' ? 'recipe warn' : 'recipe'
      aria = `${label}, ${weekday(date)}: ${row.recipe.title}, ${Math.round(row.nutrition.kcalPerServing * entry.servingsPlanned)} kcal`
    } else if (entry?.constraint) {
      kind = 'pending'
      aria = `${label}, ${weekday(date)}: ${CONSTRAINT_LABEL[entry.constraint].toLowerCase()}, not planned yet`
    } else if (entry) {
      kind = 'gone'
      aria = `${label}, ${weekday(date)}: this recipe was deleted`
    }
    // a meal that turns out to be last night's dinner says so, whatever kind of meal you asked for
    const chip = leftover && entry?.constraint !== 'out' ? 'Leftovers' : entry?.constraint ? CONSTRAINT_LABEL[entry.constraint] : null
    const when = `${label}, ${weekday(date)}`
    const tagged = entry?.id != null && !row && entry.constraint ? entry.constraint : null
    const short = row && entry ? shopping.short.get(`${date}|${slot}`) : undefined
    const shortText = short ? `Missing ${short.slice(0, 2).join(', ').toLowerCase()}${short.length > 2 ? ` +${short.length - 2}` : ''}. No grocery trip scheduled in time.` : ''
    // One box per meal. The box opens the meal sheet; what you can change without opening it (marking an empty meal as
    // leftovers, eating out or little time, and taking that mark off again) sits in the same box, below the main button.
    return (
      <div className={`plan-cell ${kind}`}>
        <button type="button" className="cell-main" aria-label={aria} onClick={() => setSheet({ kind: foods ? 'foods' : kind === 'open' || kind === 'gone' ? 'pick' : 'slot', date, slot })}>
          <span className="cell-head">
            <span className="cell-slot">{label}</span>
            {kind === 'open' ? (
              <Plus size={16} aria-hidden />
            ) : (
              entry && entry.constraint !== 'out' && <span className="cell-time">{formatTime(eatTime(entry, settings.mealTimes), settings.timeFormat)}</span>
            )}
          </span>
          {foods ? (
            <>
              <span className="cell-title">{foods.title}</span>
              <span className="cell-nums">{Math.round(foods.kcal)} kcal</span>
            </>
          ) : row && entry ? (
            <>
              <span className="cell-title">{row.recipe.title}</span>
              <span className="cell-nums">{Math.round(row.nutrition.kcalPerServing * entry.servingsPlanned)} kcal</span>
            </>
          ) : tagged === 'out' ? (
            entry?.outKcal != null && <span className="cell-nums">{Math.round(entry.outKcal)} kcal</span>
          ) : tagged ? (
            <span className="cell-title muted">Not planned yet</span>
          ) : entry ? (
            <span className="cell-title muted">Recipe deleted</span>
          ) : null}
          {chip && row && entry?.constraint !== 'out' && <span className="cell-chip">{chip}</span>}
          {short && (
            <span className="cell-short" role="status">
              <TriangleAlert size={14} aria-hidden /> {shortText}
            </span>
          )}
        </button>
        {tagged && entry && (
          <div className="cell-foot">
            <span className="cell-chip cell-tag">
              {CONSTRAINT_LABEL[tagged]}
              <button type="button" aria-label={`Clear ${when}: ${CONSTRAINT_LABEL[tagged].toLowerCase()}`} onClick={() => removeMeal(entry.id!)}>
                <X size={16} aria-hidden />
              </button>
            </span>
          </div>
        )}
        {entry?.cookDeleted && row && entry.id != null && (
          <div className="cell-foot">
            <span className="cell-chip cell-tag" role="status">
              <TriangleAlert size={14} aria-hidden /> Leftovers lost: the meal was deleted
              <button type="button" aria-label={`Dismiss warning for ${when}`} onClick={() => dismissCookDeleted(entry.id!)}>
                <X size={16} aria-hidden />
              </button>
            </span>
          </div>
        )}
        {entry?.id != null && !tagged && kind !== 'open' && (
          <button
            type="button"
            className="cell-clear"
            aria-label={`Remove ${label.toLowerCase()}, ${weekday(date)}${row ? `: ${row.recipe.title}` : foods ? `: ${foods.title}` : ''}`}
            onClick={() => removeMeal(entry.id!)}
          >
            <X size={16} aria-hidden />
          </button>
        )}
        {kind === 'open' && (
          <div className="cell-foot cell-quick" role="group" aria-label={`${when}: what kind of meal`}>
            {QUICK_KINDS.map((id) => (
              <button key={id} type="button" aria-label={`${when}: ${CONSTRAINT_LABEL[id].toLowerCase()}`} onClick={() => setConstraint(date, slot, id)}>
                {CONSTRAINT_LABEL[id]}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const sheetEntry = open ? entryAt(open.date, open.slot) : undefined
  // the meal whose foods are being chosen, when it is already a meal of plain foods (then they are edited)
  const foodsEntry = choosingFoods ? entryAt(choosingFoods.date, choosingFoods.slot) : undefined

  return (
    <section>
      <header className="page-head plan-head">
        <h1>Plan</h1>
        <Link to="/shopping" className="source-link">
          Shopping list{shopping.total > 0 ? ` (${shopping.total})` : ''}
        </Link>
      </header>

      <div className="week-nav">
        <button className="icon-btn" aria-label="Previous day" onClick={() => setStart((s) => (s > stripStart ? addDays(s, -1) : s))}>
          <ChevronLeft size={24} aria-hidden />
        </button>
        <span className="week-mid">
          {start !== today && (
            <button className="btn-quiet" onClick={() => setStart(today)}>
              Back to today
            </button>
          )}
        </span>
        <button className="icon-btn" aria-label="Next day" onClick={() => setStart((s) => addDays(s, 1))}>
          <ChevronRight size={24} aria-hidden />
        </button>
      </div>

      {note && (
        <p className="added" role="status" key={note}>
          {note}
        </p>
      )}
      {unresolved.length > 0 && (
        <div className="unresolved" role="status">
          <p>
            <strong>Could not plan {unresolved.length === 1 ? 'this meal' : 'these meals'}:</strong>
          </p>
          <ul>
            {unresolved.map((u) => (
              <li key={`${u.date}${u.slot}`}>
                {weekday(u.date)} {dayNumber(u.date)}, {SLOT_LABEL[u.slot].toLowerCase()}: {u.reason}
              </li>
            ))}
          </ul>
          <button className="btn-quiet" onClick={() => setUnresolved([])}>
            Dismiss
          </button>
        </div>
      )}

      <div className="plan-grid" ref={strip}>
        {stripDays.map((date) => {
          const totals = dayTotals(entries, date, perServing, kitchen.data.byId)
          const share = Math.min(1, totals.kcal / settings.kcalTarget)
          const slots = slotsFor(date)
          return (
            <div key={date} data-date={date} className={`plan-col${date === today ? ' today' : ''}`} role="group" aria-label={`${weekday(date)} ${dayNumber(date)}`}>
              <div className="col-head">
                <span className="col-name">
                  <span className="col-day">{weekday(date)}</span>
                  <span className="col-date">{dayNumber(date)}</span>
                  {date === today && <span className="today-tag">Today</span>}
                </span>
                <span className="col-actions">
                  {date >= today && (
                    <button
                      type="button"
                      className="col-plan"
                      aria-label={`Plan ${weekday(date)} ${dayNumber(date)}`}
                      title="Plan this day: fill its empty meals"
                      onClick={() => planDays([date])}
                    >
                      <Sparkles size={14} aria-hidden /> Plan
                    </button>
                  )}
                  {hasPlan(date) && (
                    // one button in the corner: the bin, which turns into a red tick to confirm in the same place
                    <button
                      type="button"
                      className={`col-clear${confirmDay === date ? ' confirm' : ''}`}
                      aria-label={confirmDay === date ? `Yes, clear ${weekday(date)} ${dayNumber(date)}` : `Clear ${weekday(date)} ${dayNumber(date)}`}
                      title={confirmDay === date ? 'Tap again to clear this day' : 'Clear this day'}
                      onClick={() => (confirmDay === date ? clearOneDay(date) : setConfirmDay(date))}
                      onBlur={() => confirmDay === date && setConfirmDay(null)}
                      onKeyDown={(e) => e.key === 'Escape' && setConfirmDay(null)}
                    >
                      {confirmDay === date ? <Check size={18} aria-hidden /> : <Trash2 size={16} aria-hidden />}
                    </button>
                  )}
                </span>
              </div>
              <div className="col-totals" aria-label={totals.meals > 0 ? `${Math.round(totals.kcal)} calories, ${Math.round(totals.protein)} grams protein` : 'Nothing planned'}>
                {totals.meals > 0 ? (
                  <>
                    <span>
                      <b>{Math.round(totals.kcal).toLocaleString()}</b> kcal
                    </span>
                    <span className="bar" aria-hidden>
                      <span className="bar-fill" style={{ width: `${share * 100}%` }} />
                    </span>
                    <span>{Math.round(totals.protein)} g protein</span>
                  </>
                ) : (
                  <span className="muted">No meals</span>
                )}
              </div>
              {tripButton(date, 'start')}
              {slots.map((slot) => (
                <div key={slot} className="slot-block">
                  {cell(date, slot)}
                  {tripButton(date, slot)}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {days.some(hasPlan) && (
        <div className="actions detail-actions">
          {confirmClear ? (
            <>
              <button className="btn-remove" onClick={clearThreeDays}>
                Yes, clear these days
              </button>
              <button className="btn-quiet" onClick={() => setConfirmClear(false)}>
                Keep them
              </button>
            </>
          ) : (
            <button className="btn-quiet" onClick={() => setConfirmClear(true)}>
              Clear these days
            </button>
          )}
        </div>
      )}

      <div className="calendar-box">
        <button className="btn-outline" onClick={exportCalendar}>
          <CalendarPlus size={20} aria-hidden /> Add to calendar
        </button>
        <details className="scale-more">
          <summary>How to get it into Google Calendar</summary>
          <p className="hint">
            This saves a file. It is not a live link, so after you change the plan, save it again and import it again; events already imported are
            updated, not repeated.
          </p>
          <ul className="hint">
            <li>On a computer: open calendar.google.com, then Settings, Import &amp; export, choose the file and pick a calendar.</li>
            <li>On Android: open the saved file and choose your calendar app.</li>
            <li>On an iPhone: open the file from Files and tap Add All. That goes to Apple Calendar, which can sync with Google if you set that up.</li>
          </ul>
        </details>
      </div>

      <button className="fab" onClick={planMyWeek}>
        <Sparkles size={24} aria-hidden />
        Plan these days
      </button>

      {open && (
        <SlotSheet
          key={`${open.date}${open.slot}`}
          date={open.date}
          slot={open.slot}
          entry={sheetEntry as MealPlanEntry | undefined}
          kitchen={kitchen}
          settings={settings}
          leftover={!!sheetEntry && isLeftover(sheetEntry, sessions)}
          onClose={() => setSheet(null)}
        />
      )}
      {picking && (
        <RecipePicker
          title={`${SLOT_LABEL[picking.slot]}, ${formatDate(picking.date)}`}
          rows={kitchen.rows.filter((r) => r.safety.status !== 'excluded')}
          byId={kitchen.data.byId}
          preferredCuisines={kitchen.data.settings.preferredCuisines}
          date={picking.date}
          slot={picking.slot}
          onPick={async (r) => {
            await setMeal(picking.date, picking.slot, r.recipe.id, r.recipe.servingsPerMeal || 1)
            setSheet(null)
          }}
          onFoods={() => setSheet({ kind: 'foods', date: picking.date, slot: picking.slot })}
          onClose={() => setSheet(null)}
        />
      )}
      {choosingFoods && (
        <FoodsSheet
          title={`${SLOT_LABEL[choosingFoods.slot]}, ${formatDate(choosingFoods.date)}`}
          ingredients={kitchen.data.ingredients}
          initial={isFoodsMeal(foodsEntry) ? { foods: foodsEntry.foods, borrowed: foodsEntry.borrowed } : undefined}
          onSave={async (foods, _eaten, borrowed) => {
            if (isFoodsMeal(foodsEntry) && foodsEntry.id != null) await updateFoods(foodsEntry.id, foods, borrowed)
            else await setFoods(choosingFoods.date, choosingFoods.slot, foods, borrowed)
            setSheet(null)
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {openTrip && (
        <TripSheet
          key={`${openTrip.date}${openTrip.after}`}
          date={openTrip.date}
          after={openTrip.after}
          trip={tripAt(openTrip.date, openTrip.after)}
          planSlots={planSlots}
          mealTimes={settings.mealTimes}
          timeFormat={settings.timeFormat}
          itemCount={(() => {
            const t = tripAt(openTrip.date, openTrip.after)
            return t?.id != null ? shopping.perTrip.get(t.id) : undefined
          })()}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  )
}
