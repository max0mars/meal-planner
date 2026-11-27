import './test/fakeServer'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { freshDatabase } from './test/resetDb'

beforeEach(async () => {
  await freshDatabase()
  await db.trips.add({ date: '2026-11-27', after: 'start', time: '09:00', note: 'before' })
})

describe('transactions', () => {
  it('saves everything it wrote, and inside the transaction the changes are already visible', async () => {
    await db.transaction('rw', db.trips, async () => {
      await db.trips.add({ date: '2026-11-28', after: 'lunch', time: '12:00' })
      expect(await db.trips.count()).toBe(2)
      const [first] = await db.trips.where('date').equals('2026-11-27').toArray()
      await db.trips.update(first.id!, { note: 'changed' })
    })
    const trips = await db.trips.toArray()
    expect(trips.map((t) => [t.date, t.note])).toEqual([
      ['2026-11-27', 'changed'],
      ['2026-11-28', undefined],
    ])
  })

  it('when the work throws, nothing it changed is saved', async () => {
    await expect(
      db.transaction('rw', db.trips, async () => {
        await db.trips.add({ date: '2026-11-28', after: 'lunch', time: '12:00' })
        await db.trips.clear()
        throw new Error('stopped halfway')
      }),
    ).rejects.toThrow('stopped halfway')
    expect((await db.trips.toArray()).map((t) => t.note)).toEqual(['before'])
  })

  it('when the server refuses one change, none of the changes are saved', async () => {
    await expect(
      db.transaction('rw', db.trips, db.pantryItems, async () => {
        await db.trips.add({ date: '2026-11-28', after: 'lunch', time: '12:00' })
        // a unit the database does not allow: the whole change is refused
        await db.pantryItems.add({ ingredientId: 1, qty: 2, unit: 'bucket', purchasedOn: '2026-11-26', expiresOn: '2026-12-01', location: 'fridge' } as never)
      }),
    ).rejects.toThrow(/refused/)
    expect(await db.trips.count()).toBe(1)
    expect(await db.pantryItems.count()).toBe(0)
  })

  it('returns the real id of a row it added, and that id works straight after', async () => {
    const id = await db.transaction('rw', db.trips, async () => {
      const newId = await db.trips.add({ date: '2026-11-29', after: 'dinner', time: '19:00' })
      await db.trips.update(newId, { note: 'added then edited' })
      return newId
    })
    expect(id).toBeGreaterThan(0)
    expect(await db.trips.get(id)).toMatchObject({ id, date: '2026-11-29', note: 'added then edited' })
  })

  it('a change made inside a nested transaction is part of the outer one', async () => {
    await db.transaction('rw', db.trips, async () => {
      await db.transaction('rw', db.trips, async () => {
        await db.trips.add({ date: '2026-12-01', after: 'start', time: '08:00' })
      })
      expect(await db.trips.count()).toBe(2)
    })
    expect(await db.trips.count()).toBe(2)
  })

  it('two transactions started together both apply, one after the other', async () => {
    await Promise.all([
      db.transaction('rw', db.trips, async () => {
        const [t] = await db.trips.where('date').equals('2026-11-27').toArray()
        await db.trips.update(t.id!, { note: 'first' })
      }),
      db.transaction('rw', db.trips, async () => {
        await db.trips.add({ date: '2026-12-02', after: 'start', time: '07:00' })
      }),
    ])
    const trips = await db.trips.toArray()
    expect(trips.find((t) => t.date === '2026-11-27')?.note).toBe('first')
    expect(trips.some((t) => t.date === '2026-12-02')).toBe(true)
  })
})
