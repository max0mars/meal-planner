import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, defaultExpiry } from './expiry'

describe('expiry', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2026-11-29', 3)).toBe('2026-12-02')
  })

  it('computes days between dates', () => {
    expect(daysBetween('2026-11-19', '2026-11-24')).toBe(5)
  })

  it('uses shelf life for the chosen location', () => {
    const chicken = { shelfLifeDays: { fridge: 2, freezer: 180 } }
    expect(defaultExpiry(chicken, '2026-11-19', 'fridge')).toBe('2026-11-21')
    expect(defaultExpiry(chicken, '2026-11-19', 'freezer')).toBe('2027-05-18')
  })

  it('falls back to fridge, then 7 days', () => {
    expect(defaultExpiry({ shelfLifeDays: { fridge: 4 } }, '2026-11-19', 'pantry')).toBe('2026-11-23')
    expect(defaultExpiry({ shelfLifeDays: {} }, '2026-11-19', 'pantry')).toBe('2026-11-26')
  })
})
