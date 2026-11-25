import { describe, expect, it } from 'vitest'
import { backTo, readBackTo } from './backTo'

describe('backTo', () => {
  it('reads back what a link put on the route', () => {
    expect(readBackTo(backTo('/plan', 'Plan'))).toEqual({ from: '/plan', label: 'Plan' })
  })

  it('ignores anything that is not a place to go back to', () => {
    expect(readBackTo(undefined)).toBeNull()
    expect(readBackTo(null)).toBeNull()
    expect(readBackTo({})).toBeNull()
    expect(readBackTo({ from: 'https://example.com', label: 'Elsewhere' })).toBeNull() // only places inside the app
    expect(readBackTo({ from: '/plan' })).toBeNull()
    expect(readBackTo({ from: '/plan', label: '' })).toBeNull()
    expect(readBackTo('plan')).toBeNull()
  })
})
