import '../test/fakeServer'
import { freshDatabase } from '../test/resetDb'
import { describe, expect, it } from 'vitest'
import { TAGS } from '../data/tags'
import { seedIfEmpty } from './seed'

describe('seedIfEmpty', () => {
  it('loads the curated ingredients and default settings once', async () => {
    const database = await freshDatabase()
    await seedIfEmpty(database)
    const count = await database.ingredients.count()
    expect(count).toBeGreaterThan(100)
    expect((await database.settings.get(1))?.proteinTarget).toBeGreaterThan(0)

    await seedIfEmpty(database) // idempotent
    expect(await database.ingredients.count()).toBe(count)

    const eggs = await database.ingredients.where('name').equals('Eggs').first()
    expect(eggs?.proteinPer100g).toBeGreaterThan(10)
    expect(eggs?.sensitivity).toBe('safe')
    expect(eggs?.tags).toContain('egg')
  })

  it('adds newly released ingredients without overwriting your labels', async () => {
    const database = await freshDatabase()
    await seedIfEmpty(database)
    const total = await database.ingredients.count()

    // simulate an older install: user labelled Eggs, and Raspberries did not exist yet
    const eggs = (await database.ingredients.where('name').equals('Eggs').first())!
    await database.ingredients.update(eggs.id!, { sensitivity: 'major' })
    await database.ingredients.where('name').equals('Raspberries').delete()
    expect(await database.ingredients.count()).toBe(total - 1)

    await seedIfEmpty(database)
    expect(await database.ingredients.count()).toBe(total)
    expect((await database.ingredients.where('name').equals('Eggs').first())?.sensitivity).toBe('major')
    expect(await database.ingredients.where('name').equals('Raspberries').count()).toBe(1)
  })

  it('has one entry per concept (a single plain "Whole milk", not dozens of milks)', async () => {
    const database = await freshDatabase()
    await seedIfEmpty(database)
    const milks = await database.ingredients.filter((i) => /\bmilk\b/i.test(i.name)).toArray()
    expect(milks.length).toBeLessThan(10)
  })

  it('only uses known tags, and gluten/dairy/lactose/oats tags are populated', async () => {
    const database = await freshDatabase()
    await seedIfEmpty(database)
    const known = new Set(TAGS.map((t) => t.id))
    const all = await database.ingredients.toArray()
    for (const i of all) for (const t of i.tags) expect(known.has(t), `${i.name} has unknown tag ${t}`).toBe(true)
    for (const tag of ['gluten', 'dairy', 'lactose', 'oats']) {
      expect(await database.ingredients.where('tags').equals(tag).count(), tag).toBeGreaterThan(0)
    }
  })
})
