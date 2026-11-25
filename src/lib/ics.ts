import type { MealPlanEntry, Settings, Trip } from '../types'
import { SLOT_LABEL, isLeftover, type CookSession } from './plan'
import { eatTime, toMinutes } from './times'

// An .ics file (RFC 5545): a text file that Google Calendar, Apple Calendar and Outlook can all import.

const EAT_MINUTES = 30
const SHOP_MINUTES = 60

/** Text values: backslash, semicolon, comma and line breaks are escaped. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Lines may be at most 75 bytes. A longer one continues on the next line, which starts with one space. Never splits a character. */
export function foldLine(line: string): string {
  const encoder = new TextEncoder()
  if (encoder.encode(line).length <= 75) return line
  const parts: string[] = []
  let current = ''
  let size = 0
  let limit = 75 // continuation lines lose one byte to the leading space
  for (const ch of line) {
    const bytes = encoder.encode(ch).length
    if (size + bytes > limit) {
      parts.push(current)
      current = ''
      size = 0
      limit = 74
    }
    current += ch
    size += bytes
  }
  parts.push(current)
  return parts.join('\r\n ')
}

/** A local date and time (as on your calendar) as the UTC stamp a calendar file wants: 20261125T123000Z. */
export function utcStamp(date: string, hhmm: string, minutesLater = 0): string {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(y, m - 1, d, 0, toMinutes(hhmm) + minutesLater) // the Date constructor works in this device's time zone
  return at.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export interface CalendarRecipe {
  title: string
  estMinutes: number
  source?: string
}

export interface CalendarInput {
  entries: MealPlanEntry[]
  trips: Trip[]
  recipes: Map<number, CalendarRecipe>
  sessions: CookSession[]
  mealTimes: NonNullable<Settings['mealTimes']>
  /** What to buy on each trip, as lines of text, by trip id. */
  shopping: Map<number, string[]>
  /** Only meals and trips from this day on are included. */
  from: string
  /** The moment the file was made, for the stamp on each event. */
  now?: Date
}

interface Event {
  uid: string
  start: string
  end: string
  summary: string
  description?: string
}

/** The plan from `from` on as events: eating (and eating out), and grocery trips. */
export function calendarEvents(input: CalendarInput): Event[] {
  const events: Event[] = []
  for (const e of input.entries) {
    if (e.status !== 'planned' || e.date < input.from) continue
    const when = eatTime(e, input.mealTimes)
    const label = SLOT_LABEL[e.slot]
    if (e.constraint === 'out') {
      events.push({ uid: `eat-${e.date}-${e.slot}`, start: utcStamp(e.date, when), end: utcStamp(e.date, when, EAT_MINUTES), summary: `${label}: eating out` })
      continue
    }
    const recipe = e.recipeId == null ? undefined : input.recipes.get(e.recipeId)
    if (!recipe) continue // not planned yet, or the recipe was deleted: nothing to put on a calendar
    const leftover = isLeftover(e, input.sessions)
    events.push({
      uid: `eat-${e.date}-${e.slot}`,
      start: utcStamp(e.date, when),
      end: utcStamp(e.date, when, EAT_MINUTES),
      summary: `${label}: ${recipe.title}${leftover ? ' (leftovers)' : ''}`,
      description: recipe.source && /^https?:\/\//.test(recipe.source) ? recipe.source : undefined,
    })
  }
  for (const t of input.trips) {
    if (t.date < input.from) continue
    const items = t.id != null ? (input.shopping.get(t.id) ?? []) : []
    events.push({
      uid: `shop-${t.date}-${t.after}`,
      start: utcStamp(t.date, t.time),
      end: utcStamp(t.date, t.time, SHOP_MINUTES),
      summary: 'Groceries',
      description: [t.note, items.length > 0 ? `To buy:\n${items.map((i) => `- ${i}`).join('\n')}` : 'Nothing on the list for this trip.'].filter(Boolean).join('\n'),
    })
  }
  return events.sort((a, b) => a.start.localeCompare(b.start) || a.uid.localeCompare(b.uid))
}

/** The whole .ics file. Each event has a fixed id, so importing it again updates the events instead of repeating them. */
export function buildCalendar(input: CalendarInput): string {
  const stamp = (input.now ?? new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Meal Planner//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Meal plan']
  for (const e of calendarEvents(input)) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@meal-planner`, `DTSTAMP:${stamp}`, `DTSTART:${e.start}`, `DTEND:${e.end}`, `SUMMARY:${escapeText(e.summary)}`)
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(foldLine).join('\r\n')}\r\n`
}

export const calendarFileName = (from: string) => `meal-plan-${from}.ics`

