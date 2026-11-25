import { describe, expect, it } from 'vitest'
import { effectiveSensitivity, strictest, tagLevelMap } from './sensitivity'

const levels = tagLevelMap([
  { tag: 'gluten', sensitivity: 'major' },
  { tag: 'lactose', sensitivity: 'light' },
  { tag: 'oats', sensitivity: 'safe' },
])

describe('effectiveSensitivity', () => {
  it('strictest picks major over light over safe', () => {
    expect(strictest('safe', 'light')).toBe('light')
    expect(strictest('major', 'light')).toBe('major')
    expect(strictest('safe', 'safe')).toBe('safe')
  })

  it('a major tag makes every tagged ingredient major', () => {
    const r = effectiveSensitivity({ sensitivity: 'safe', tags: ['gluten', 'wheat'] }, levels)
    expect(r.level).toBe('major')
    expect(r.reasons).toEqual(['gluten'])
  })

  it('a light tag gives light', () => {
    expect(effectiveSensitivity({ sensitivity: 'safe', tags: ['dairy', 'lactose'] }, levels).level).toBe('light')
  })

  it('an ingredient-level label beats a milder tag', () => {
    const r = effectiveSensitivity({ sensitivity: 'major', tags: ['lactose'] }, levels)
    expect(r.level).toBe('major')
    expect(r.fromIngredient).toBe(true)
    expect(r.reasons).toEqual([])
  })

  it('untagged or safe-tagged ingredients stay safe', () => {
    expect(effectiveSensitivity({ sensitivity: 'safe', tags: [] }, levels).level).toBe('safe')
    expect(effectiveSensitivity({ sensitivity: 'safe', tags: ['oats'] }, levels).level).toBe('safe')
  })
})
