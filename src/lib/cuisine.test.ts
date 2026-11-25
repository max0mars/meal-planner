import { describe, expect, it } from 'vitest'
import recipes from '../data/recipes.seed.json'
import { cuisineLabel, isFamiliar } from './cuisine'

describe('cuisine labels', () => {
  it('turns a country into the name people would use, and leaves demonyms alone', () => {
    expect(cuisineLabel('Netherlands')).toBe('Dutch')
    expect(cuisineLabel('United States')).toBe('American')
    expect(cuisineLabel('France')).toBe('French')
    expect(cuisineLabel('British')).toBe('British')
    expect(cuisineLabel('  Polish ')).toBe('Polish')
  })

  it('has nothing to say when the source gave nothing', () => {
    expect(cuisineLabel(null)).toBeUndefined()
    expect(cuisineLabel('')).toBeUndefined()
    expect(cuisineLabel('Unknown')).toBeUndefined()
  })
})

describe('familiar meals', () => {
  it('counts western European, North American and Australian cuisines, and not the rest', () => {
    for (const c of ['British', 'Irish', 'French', 'Italian', 'Spanish', 'Greek', 'Dutch', 'Norwegian', 'American', 'Canadian', 'Australian']) {
      expect(isFamiliar(c), c).toBe(true)
    }
    for (const c of ['Jamaican', 'Turkish', 'Albanian', 'Brazilian', 'Saudi Arabian', 'Thai', 'Japanese', 'Kenyan']) {
      expect(isFamiliar(c), c).toBe(false)
    }
  })

  it('treats a recipe with no cuisine, such as one you wrote, as familiar', () => {
    expect(isFamiliar(undefined)).toBe(true)
    expect(isFamiliar(null)).toBe(true)
    expect(isFamiliar('')).toBe(true)
  })
})

describe('the starter recipes', () => {
  const all = recipes as { title: string; cuisine?: string }[]

  it('every recipe has a cuisine, written the way people say it', () => {
    for (const r of all) {
      expect(r.cuisine, r.title).toBeTruthy()
      expect(['Netherlands', 'Norway', 'France', 'United States', 'Belgium', 'Denmark'], `${r.title}: ${r.cuisine}`).not.toContain(r.cuisine)
    }
  })

  it('a good share are familiar, including Italian ones', () => {
    const familiar = all.filter((r) => isFamiliar(r.cuisine))
    expect(familiar.length).toBeGreaterThan(85)
    expect(all.filter((r) => r.cuisine === 'Italian').length).toBeGreaterThanOrEqual(3) // most of the source's Italian recipes need foods USDA does not carry (mascarpone, for one)
  })
})

describe('cuisine regions', () => {
  it('are a handful of broad groups, not one per cuisine', async () => {
    const { CUISINE_REGIONS } = await import('./cuisine')
    expect(CUISINE_REGIONS.length).toBeGreaterThanOrEqual(6)
    expect(CUISINE_REGIONS.length).toBeLessThanOrEqual(10)
    const all = CUISINE_REGIONS.flatMap((r) => r.cuisines)
    expect(new Set(all).size).toBe(all.length) // a cuisine is in one region only
  })

  it('cover every cuisine in the starter recipes, with a real number of recipes in each region', async () => {
    const { CUISINE_REGIONS, cuisineRegion } = await import('./cuisine')
    const counts = new Map<string, number>()
    for (const r of recipes) {
      if (!r.cuisine) continue
      const region = cuisineRegion(r.cuisine)
      expect(region, `${r.cuisine} has no region`).toBeTruthy()
      counts.set(region!, (counts.get(region!) ?? 0) + 1)
    }
    for (const region of CUISINE_REGIONS) expect(counts.get(region.name) ?? 0, region.name).toBeGreaterThanOrEqual(9)
  })

  it('finds a region from a cuisine, and treats an unknown cuisine as nothing to hold back', async () => {
    const { cuisineRegion, isPreferred } = await import('./cuisine')
    expect(cuisineRegion('Italian')).toBe('Southern European')
    expect(cuisineRegion('Thai')).toBe('Asian')
    expect(cuisineRegion('Fusion')).toBeUndefined()
    expect(isPreferred('Italian', ['Southern European'])).toBe(true)
    expect(isPreferred('Italian', ['Asian'])).toBe(false)
    expect(isPreferred('Italian', [])).toBe(false)
    expect(isPreferred('Fusion', [])).toBe(true) // belongs to no region
    expect(isPreferred(undefined, [])).toBe(true) // your own recipe with no cuisine
  })
})
