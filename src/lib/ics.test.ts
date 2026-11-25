import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../db'
import type { MealPlanEntry, MealSlot, Trip } from '../types'
import { buildCalendar, calendarEvents, escapeText, foldLine, utcStamp, type CalendarInput } from './ics'
import { cookSessions } from './plan'

const TIMES = DEFAULT_SETTINGS.mealTimes!
const NOW = new Date('2026-11-19T08:00:00Z')
let nextId = 1
const meal = (date: string, slot: MealSlot, over: Partial<MealPlanEntry> = {}): MealPlanEntry => ({ id: nextId++, date, slot, servingsPlanned: 1, status: 'planned', ...over })
const trip = (date: string, after: Trip['after'], time: string, note?: string): Trip => ({ id: nextId++, date, after, time, note })

const recipes = new Map([
  [1, { title: 'Chicken and rice', estMinutes: 45, source: 'https://example.com/chicken' }],
  [2, { title: 'Beef stew, with dumplings; slow', estMinutes: 120 }],
])

function input(over: Partial<CalendarInput> = {}): CalendarInput {
  const entries = over.entries ?? []
  return { entries, trips: [], recipes, sessions: cookSessions(entries, 4), mealTimes: TIMES, shopping: new Map(), from: '2026-11-19', now: NOW, ...over }
}

/** The file read back by an independent iCalendar parser. */
function parse(text: string) {
  const root = new ICAL.Component(ICAL.parse(text))
  return root.getAllSubcomponents('vevent').map((v) => {
    const ev = new ICAL.Event(v)
    return { uid: ev.uid, summary: ev.summary, description: ev.description, start: ev.startDate.toJSDate(), end: ev.endDate.toJSDate() }
  })
}

describe('writing an .ics file', () => {
  it('escapes commas, semicolons, backslashes and line breaks', () => {
    expect(escapeText('a, b; c\\d\ne')).toBe('a\\, b\\; c\\\\d\\ne')
  })

  it('folds lines at 75 bytes without splitting a character, and unfolding gives the original', () => {
    const long = `DESCRIPTION:${'é'.repeat(80)} ${'x'.repeat(60)}`
    const folded = foldLine(long)
    const physical = folded.split('\r\n')
    expect(physical.length).toBeGreaterThan(2)
    for (const l of physical) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75)
    for (const l of physical.slice(1)) expect(l.startsWith(' ')).toBe(true)
    expect(physical.map((l, i) => (i === 0 ? l : l.slice(1))).join('')).toBe(long)
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short')
  })

  it('turns your local time into the UTC time a calendar file needs', () => {
    expect(utcStamp('2026-11-25', '12:30')).toBe(new Date(2026, 10, 25, 12, 30).toISOString().replace(/[-:]/g, '').replace('.000', ''))
    expect(utcStamp('2026-11-25', '23:45', 30)).toBe(new Date(2026, 10, 26, 0, 15).toISOString().replace(/[-:]/g, '').replace('.000', '')) // crosses midnight
  })

  it('is a valid calendar an independent parser can read, with the right start and end times', () => {
    const text = buildCalendar(input({ entries: [meal('2026-11-25', 'dinner', { recipeId: 1 })] }))
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(text).toContain('VERSION:2.0')
    expect(text).toContain('PRODID:-//Meal Planner//EN')
    const events = parse(text)
    const eat = events.find((e) => e.uid === 'eat-2026-11-25-dinner@meal-planner')!
    expect(eat.summary).toBe('Dinner: Chicken and rice')
    expect(eat.start.getTime()).toBe(new Date(2026, 10, 25, 18, 30).getTime())
    expect(eat.end.getTime()).toBe(new Date(2026, 10, 25, 19, 0).getTime())
    expect(eat.description).toBe('https://example.com/chicken')
  })

  it('adds a cooking block ending when you eat, for a meal cooked fresh', () => {
    const events = parse(buildCalendar(input({ entries: [meal('2026-11-25', 'dinner', { recipeId: 1 })] })))
    const cook = events.find((e) => e.uid.startsWith('cook-'))!
    expect(cook.summary).toBe('Cook: Chicken and rice')
    expect(cook.start.getTime()).toBe(new Date(2026, 10, 25, 17, 45).getTime()) // 45 minute recipe, ready at 18:30
    expect(cook.end.getTime()).toBe(new Date(2026, 10, 25, 18, 30).getTime())
    expect(cook.description).toContain('Makes 1 serving')
  })

  it('uses the eat and cook times you set on a meal', () => {
    const events = parse(buildCalendar(input({ entries: [meal('2026-11-25', 'dinner', { recipeId: 1, eatAt: '20:00', cookAt: '19:00' })] })))
    expect(events.find((e) => e.uid.startsWith('eat-'))!.start.getTime()).toBe(new Date(2026, 10, 25, 20, 0).getTime())
    expect(events.find((e) => e.uid.startsWith('cook-'))!.start.getTime()).toBe(new Date(2026, 10, 25, 19, 0).getTime())
  })

  it('leftovers are eaten but not cooked again, and the cook makes enough for both', () => {
    const entries = [meal('2026-11-24', 'dinner', { recipeId: 1 }), meal('2026-11-25', 'lunch', { recipeId: 1 })]
    const events = parse(buildCalendar(input({ entries })))
    expect(events.filter((e) => e.uid.startsWith('cook-'))).toHaveLength(1)
    expect(events.find((e) => e.uid === 'eat-2026-11-25-lunch@meal-planner')!.summary).toBe('Lunch: Chicken and rice (leftovers)')
    expect(events.find((e) => e.uid.startsWith('cook-'))!.description).toContain('Makes 2 servings')
  })

  it('eating out is an event with no cooking, and a meal with nothing planned yet is left out', () => {
    const entries = [meal('2026-11-26', 'dinner', { constraint: 'out' }), meal('2026-11-27', 'lunch', { constraint: 'leftovers' }), meal('2026-11-27', 'dinner', { recipeId: 99 })]
    const events = parse(buildCalendar(input({ entries })))
    expect(events.map((e) => e.summary)).toEqual(['Dinner: eating out'])
  })

  it('adds grocery trips with what to buy and the note', () => {
    const t = trip('2026-11-23', 'start', '09:30', 'big shop')
    const events = parse(buildCalendar(input({ trips: [t], shopping: new Map([[t.id!, ['Chicken breast 400 g', 'Rice 200 g']]]) })))
    expect(events).toHaveLength(1)
    expect(events[0].summary).toBe('Groceries')
    expect(events[0].start.getTime()).toBe(new Date(2026, 10, 23, 9, 30).getTime())
    expect(events[0].end.getTime()).toBe(new Date(2026, 10, 23, 10, 30).getTime())
    expect(events[0].description).toBe('big shop\nTo buy:\n- Chicken breast 400 g\n- Rice 200 g')
  })

  it('keeps special characters in a title intact when read back', () => {
    const events = parse(buildCalendar(input({ entries: [meal('2026-11-25', 'dinner', { recipeId: 2 })] })))
    expect(events.map((e) => e.summary).sort()).toEqual(['Cook: Beef stew, with dumplings; slow', 'Dinner: Beef stew, with dumplings; slow'])
  })

  it('only includes meals and trips from the start date on, and skips meals already cooked or skipped', () => {
    const entries = [
      meal('2026-11-18', 'dinner', { recipeId: 1 }),
      // a different recipe: a made meal of recipe 1 would make the dinner after it leftovers
      meal('2026-11-25', 'lunch', { recipeId: 2, status: 'cooked' }),
      meal('2026-11-25', 'dinner', { recipeId: 2, status: 'skipped' }),
      meal('2026-11-26', 'dinner', { recipeId: 1 }),
    ]
    const events = calendarEvents(input({ entries, trips: [trip('2026-11-10', 'start', '09:00'), trip('2026-11-22', 'start', '09:00')] }))
    expect(events.map((e) => e.uid).sort()).toEqual(['cook-2026-11-26-dinner', 'eat-2026-11-26-dinner', 'shop-2026-11-22-start'])
  })

  it('gives every event the same id each time, so importing twice updates instead of duplicating', () => {
    const entries = [meal('2026-11-25', 'dinner', { recipeId: 1 })]
    const a = parse(buildCalendar(input({ entries }))).map((e) => e.uid)
    const b = parse(buildCalendar(input({ entries, now: new Date('2026-12-01T00:00:00Z') }))).map((e) => e.uid)
    expect(a).toEqual(b)
    expect(new Set(a).size).toBe(a.length)
  })

  it('does not start cooking after you eat (a recipe cannot be cooked in negative time)', () => {
    const events = parse(buildCalendar(input({ entries: [meal('2026-11-25', 'dinner', { recipeId: 1, eatAt: '18:30', cookAt: '18:30' })] })))
    expect(events.some((e) => e.uid.startsWith('cook-'))).toBe(false)
  })
})
