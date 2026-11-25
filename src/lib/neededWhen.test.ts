import { describe, expect, it } from 'vitest'
import { formatDate } from './pantry'
import { dueCounts, missingWithNoTrip, neededWhen, type ShopItem } from './shopping'

const TODAY = '2026-11-21'

describe('neededWhen', () => {
  it('says today and tomorrow, and marks them urgent', () => {
    expect(neededWhen('2026-11-21', TODAY)).toEqual({ text: 'today', label: 'Today', urgent: true })
    expect(neededWhen('2026-11-22', TODAY)).toEqual({ text: 'tomorrow', label: 'Tomorrow', urgent: true })
  })

  it('counts days up to 5, which are not urgent', () => {
    expect(neededWhen('2026-11-23', TODAY)).toEqual({ text: 'in 2 days', label: 'In 2 days', urgent: false })
    expect(neededWhen('2026-11-26', TODAY)).toEqual({ text: 'in 5 days', label: 'In 5 days', urgent: false })
  })

  it('gives a date once it is more than 5 days away', () => {
    expect(neededWhen('2026-11-27', TODAY)).toEqual({ text: `by ${formatDate('2026-11-27')}`, label: `By ${formatDate('2026-11-27')}`, urgent: false })
    expect(neededWhen('2026-12-30', TODAY).text).toBe(`by ${formatDate('2026-12-30')}`)
  })

  it('treats a date already past as today', () => {
    expect(neededWhen('2026-11-19', TODAY)).toEqual({ text: 'today', label: 'Today', urgent: true })
  })
})

describe('dueCounts', () => {
  it('counts what is needed today and tomorrow, with past dates as today', () => {
    const items = ['2026-11-19', '2026-11-21', '2026-11-21', '2026-11-22', '2026-11-23', '2026-12-30'].map((needBy) => ({ needBy }))
    expect(dueCounts(items, TODAY)).toEqual({ today: 3, tomorrow: 1 })
  })

  it('is zero for both when nothing is due soon, or the list is empty', () => {
    expect(dueCounts([{ needBy: '2026-11-25' }], TODAY)).toEqual({ today: 0, tomorrow: 0 })
    expect(dueCounts([], TODAY)).toEqual({ today: 0, tomorrow: 0 })
  })
})

describe('missingWithNoTrip', () => {
  const item = (needBy: string) => ({ needBy, food: { name: needBy } }) as unknown as ShopItem

  it('with trips planned, is what is needed before the first trip', () => {
    const early = [item('2026-11-21')]
    expect(missingWithNoTrip([item('2026-11-21'), item('2026-11-30')], { groups: [], beforeFirstTrip: early })).toBe(early)
    expect(missingWithNoTrip([item('2026-11-21')], { groups: [], beforeFirstTrip: [] })).toEqual([])
  })

  it('with no trips scheduled, is everything still to buy', () => {
    const items = [item('2026-11-21'), item('2026-11-24'), item('2026-12-30')]
    expect(missingWithNoTrip(items, null)).toEqual(items)
    expect(missingWithNoTrip([], null)).toEqual([])
  })
})
