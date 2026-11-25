import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../db'
import { cookStart, cookTime, defaultTripTime, eatTime, fromMinutes, passedSlots, toMinutes } from './times'
import { tripPosition } from './trips'

const TIMES = DEFAULT_SETTINGS.mealTimes! // breakfast 08:00, lunch 12:30, dinner 18:30, snack 15:30

describe('times', () => {
  it('converts between HH:MM and minutes', () => {
    expect(toMinutes('18:30')).toBe(1110)
    expect(fromMinutes(1110)).toBe('18:30')
    expect(fromMinutes(-20)).toBe('00:00')
    expect(fromMinutes(99999)).toBe('23:59')
  })

  it('eats at the time you set on the meal, otherwise your usual time', () => {
    expect(eatTime({ slot: 'dinner' }, TIMES)).toBe('18:30')
    expect(eatTime({ slot: 'dinner', eatAt: '20:00' }, TIMES)).toBe('20:00')
  })

  it('starts cooking early enough, on a 5 minute mark, and never late', () => {
    expect(cookStart('18:30', 45)).toBe('17:45')
    expect(cookStart('18:30', 47)).toBe('17:40') // 17:43 rounds earlier, not later
    expect(cookStart('18:30', 120)).toBe('16:30')
    expect(cookStart('00:20', 60)).toBe('00:00') // cannot start before midnight
  })

  it('uses a cook time you set over the worked-out one', () => {
    expect(cookTime({ slot: 'dinner' }, 45, TIMES)).toBe('17:45')
    expect(cookTime({ slot: 'dinner', eatAt: '20:00' }, 45, TIMES)).toBe('19:15') // follows a changed eat time
    expect(cookTime({ slot: 'dinner', cookAt: '16:00' }, 45, TIMES)).toBe('16:00')
  })

  it('puts a grocery trip 90 minutes before the first meal, midway between meals, and 90 minutes after the last', () => {
    const meals = ['lunch', 'dinner'] as const
    expect(defaultTripTime('start', [...meals], TIMES)).toBe('11:00')
    expect(defaultTripTime('lunch', [...meals], TIMES)).toBe('15:30') // midway between 12:30 and 18:30
    expect(defaultTripTime('dinner', [...meals], TIMES)).toBe('20:00')
  })

  it('follows the meals you plan', () => {
    expect(defaultTripTime('start', ['dinner'], TIMES)).toBe('17:00')
    expect(defaultTripTime('breakfast', ['breakfast', 'lunch', 'dinner'], TIMES)).toBe('10:15')
    expect(defaultTripTime('start', [], TIMES)).toBe('09:00')
  })
})


describe('saying where a trip is', () => {
  it('names the meals either side, following the meals you plan', () => {
    expect(tripPosition('start', ['lunch', 'dinner'])).toBe('before lunch')
    expect(tripPosition('lunch', ['lunch', 'dinner'])).toBe('between lunch and dinner')
    expect(tripPosition('dinner', ['lunch', 'dinner'])).toBe('after dinner')
    expect(tripPosition('start', ['breakfast', 'dinner'])).toBe('before breakfast')
    expect(tripPosition('lunch', ['dinner'])).toBe('between lunch and dinner') // lunch is not planned, but the trip was set after it
    expect(tripPosition('start', [])).toBe('in the morning')
  })
})

describe('meals that have already gone today', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 19, h, m)
  it('counts a meal as gone once its usual time is reached', () => {
    expect(passedSlots('2026-11-19', at(6), ['lunch', 'dinner'], TIMES)).toEqual([])
    expect(passedSlots('2026-11-19', at(12, 29), ['lunch', 'dinner'], TIMES)).toEqual([])
    expect(passedSlots('2026-11-19', at(12, 30), ['lunch', 'dinner'], TIMES)).toEqual(['2026-11-19|lunch'])
    expect(passedSlots('2026-11-19', at(19), ['lunch', 'dinner'], TIMES)).toEqual(['2026-11-19|lunch', '2026-11-19|dinner'])
  })
  it('only looks at the meals you plan', () => {
    expect(passedSlots('2026-11-19', at(19), ['dinner'], TIMES)).toEqual(['2026-11-19|dinner'])
  })
})

describe('formatTime', () => {
  it('shows 24-hour times as 12-hour with AM or PM', async () => {
    const { formatTime } = await import('./times')
    expect(formatTime('00:00')).toBe('12:00 AM') // midnight
    expect(formatTime('00:05')).toBe('12:05 AM')
    expect(formatTime('08:00')).toBe('8:00 AM')
    expect(formatTime('11:59')).toBe('11:59 AM')
    expect(formatTime('12:00')).toBe('12:00 PM') // noon
    expect(formatTime('12:30')).toBe('12:30 PM')
    expect(formatTime('13:15')).toBe('1:15 PM')
    expect(formatTime('18:30')).toBe('6:30 PM')
    expect(formatTime('23:59')).toBe('11:59 PM')
  })
})

describe('formatTime in 24-hour form', () => {
  it('shows HH:MM, with the hour padded', async () => {
    const { formatTime } = await import('./times')
    expect(formatTime('00:05', '24h')).toBe('00:05')
    expect(formatTime('08:00', '24h')).toBe('08:00')
    expect(formatTime('18:30', '24h')).toBe('18:30')
    expect(formatTime('18:30', '12h')).toBe('6:30 PM')
    expect(formatTime('18:30')).toBe('6:30 PM') // 12-hour unless told otherwise
  })
})

describe('slotOrder', () => {
  it('puts a snack where its time falls, between lunch and dinner by default', async () => {
    const { slotOrder } = await import('./times')
    expect(slotOrder(TIMES)).toEqual(['breakfast', 'lunch', 'snack', 'dinner'])
    expect(slotOrder({ ...TIMES, snack: '21:00' })).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
    expect(slotOrder({ ...TIMES, snack: '07:00' })).toEqual(['snack', 'breakfast', 'lunch', 'dinner'])
  })

  it('keeps breakfast, lunch, dinner, snack when meals share a time', async () => {
    const { slotOrder } = await import('./times')
    expect(slotOrder({ breakfast: '12:00', lunch: '12:00', dinner: '12:00', snack: '12:00' })).toEqual(['breakfast', 'lunch', 'dinner', 'snack'])
  })

  it('places grocery trips by that order, so a trip after a snack is before dinner', async () => {
    const { slotOrder } = await import('./times')
    const order = slotOrder(TIMES)
    const { tripBefore, tripPosition } = await import('./trips')
    expect(tripPosition('lunch', ['lunch', 'dinner', 'snack'], order)).toBe('between lunch and a snack')
    expect(tripPosition('snack', ['lunch', 'dinner', 'snack'], order)).toBe('between a snack and dinner')
    expect(tripPosition('dinner', ['lunch', 'dinner', 'snack'], order)).toBe('after dinner')
    expect(tripBefore({ date: '2026-11-20', after: 'snack' }, '2026-11-20', 'dinner', order)).toBe(true) // after the snack, before dinner
    expect(tripBefore({ date: '2026-11-20', after: 'snack' }, '2026-11-20', 'dinner')).toBe(false) // the old fixed order
  })

  it('works out a default trip time between the meals as eaten', async () => {
    const { defaultTripTime } = await import('./times')
    // lunch 12:30, snack 15:30: midway is 14:00. Dinner is 18:30: after the snack, midway is 17:00.
    expect(defaultTripTime('lunch', ['lunch', 'dinner', 'snack'], TIMES)).toBe('14:00')
    expect(defaultTripTime('snack', ['lunch', 'dinner', 'snack'], TIMES)).toBe('17:00')
    expect(defaultTripTime('dinner', ['lunch', 'dinner', 'snack'], TIMES)).toBe('20:00')
  })
})
