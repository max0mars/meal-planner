// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import viteConfig from '../vite.config.ts?raw'
import mainSource from './main.tsx?raw'
import { DEFAULT_SETTINGS, MealPlannerDB, db } from './db'
import { backupFileName, BackupError, exportBackup, parseBackup, restoreBackup } from './lib/backup'
import { seedIfEmpty } from './lib/seed'
import { seedBaselineRecipes } from './lib/seedRecipes'

let n = 0
async function populated() {
  const database = new MealPlannerDB(`backup-${n++}`)
  await seedIfEmpty(database)
  await seedBaselineRecipes(database)
  const milk = (await database.ingredients.where('name').equals('Whole milk').first())!
  await database.pantryItems.add({ ingredientId: milk.id!, quantity: 1000, unit: 'ml', location: 'fridge', purchasedOn: '2026-01-01', expiresOn: '2026-01-08' } as never)
  await database.trips.add({ date: '2026-01-05', after: 'start', time: '09:00', note: 'big shop' })
  await database.tagSensitivities.put({ tag: 'gluten', level: 'major' } as never)
  return database
}

afterEach(cleanup)

describe('backup and restore', () => {
  it('a restored backup is identical to what was saved, in every table', async () => {
    const source = await populated()
    const backup = await exportBackup(source)
    const target = new MealPlannerDB(`backup-${n++}`)
    await restoreBackup(parseBackup(JSON.stringify(backup)), target)
    for (const t of ['ingredients', 'pantryItems', 'recipes', 'trips', 'tagSensitivities', 'settings']) {
      expect(await target.table(t).toArray(), t).toEqual(await source.table(t).toArray())
    }
  })

  it('restoring replaces what was there', async () => {
    const source = await populated()
    const backup = await exportBackup(source)
    const target = new MealPlannerDB(`backup-${n++}`)
    await seedIfEmpty(target)
    await target.trips.add({ date: '2030-01-01', after: 'start', time: '10:00' })
    await restoreBackup(backup, target)
    expect((await target.trips.toArray()).map((t) => t.date)).toEqual(['2026-01-05'])
  })

  it('rejects files that are not backups, and changes nothing', async () => {
    const target = await populated()
    const before = await target.recipes.count()
    expect(() => parseBackup('not json')).toThrow(BackupError)
    expect(() => parseBackup('{"hello":1}')).toThrow(/not a Meal Planner backup/)
    const damaged = JSON.parse(JSON.stringify(await exportBackup(target)))
    delete damaged.tables.recipes
    expect(() => parseBackup(JSON.stringify(damaged))).toThrow(/recipes/)
    expect(await target.recipes.count()).toBe(before)
  })

  it('a failed restore rolls back: nothing is half written', async () => {
    const target = await populated()
    const before = await target.recipes.count()
    const bad = await exportBackup(target)
    bad.tables.pantryItems = [{ id: 1 }, { id: 1 }] // a duplicate key makes bulkAdd fail midway
    await expect(restoreBackup(bad, target)).rejects.toBeTruthy()
    expect(await target.recipes.count()).toBe(before)
    expect(await target.trips.count()).toBe(1)
  })

  it('names the file by date', () => {
    expect(backupFileName(new Date('2026-03-04T12:00:00Z'))).toBe('meal-planner-backup-2026-03-04.json')
  })
})

describe('the Settings screen', () => {
  const open = () =>
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <App />
      </MemoryRouter>,
    )
  it('saves a changed meal time and keeps the others', async () => {
    await seedIfEmpty()
    await db.settings.put({ ...DEFAULT_SETTINGS })
    open()
    const [hour, minute, period] = within(await screen.findByRole('group', { name: 'Dinner' })).getAllByRole('combobox') as HTMLSelectElement[]
    fireEvent.change(hour, { target: { value: '7' } }) // 7:15 PM, picked from the 12-hour fields
    fireEvent.change(minute, { target: { value: '15' } })
    expect(period.value).toBe('PM')
    await waitFor(async () => expect((await db.settings.get(1))!.mealTimes).toMatchObject({ dinner: '19:15', lunch: '12:30' }))
  })

  it('switches times between 12-hour and 24-hour, and an old install starts on 12-hour', async () => {
    await seedIfEmpty()
    // settings saved before the option existed have no format
    const { timeFormat: _omit, ...old } = DEFAULT_SETTINGS
    void _omit
    await db.settings.put(old)
    open()
    const dinner = async () => within(await screen.findByRole('group', { name: 'Dinner' })).getAllByRole('combobox') as HTMLSelectElement[]
    expect(await dinner()).toHaveLength(3) // hour, minute, AM or PM
    expect((await dinner())[0].value).toBe('6')
    expect(screen.getByRole('button', { name: /^12-hour/ }).getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: /^24-hour/ }))
    await waitFor(async () => expect((await db.settings.get(1))!.timeFormat).toBe('24h'))
    await waitFor(async () => expect(await dinner()).toHaveLength(2)) // hour and minute only
    const [hour, minute] = await dinner()
    expect(hour.value).toBe('18')
    expect(minute.value).toBe('30')
    expect(hour.options).toHaveLength(24)

    // picking in 24-hour form saves the same HH:MM as before
    fireEvent.change(hour, { target: { value: '19' } })
    await waitFor(async () => expect((await db.settings.get(1))!.mealTimes).toMatchObject({ dinner: '19:30', lunch: '12:30' }))

    fireEvent.click(screen.getByRole('button', { name: /^12-hour/ }))
    await waitFor(async () => expect((await dinner())[0].value).toBe('7'))
    expect((await dinner())[2].value).toBe('PM')
  })

  describe('everyday meals: choosing kinds of food', () => {
    beforeEach(async () => {
      await db.recipes.clear() // earlier tests leave recipes behind, and the counts come from them
    })
    const recipe = (title: string, cuisine?: string) => ({
      title, servings: 4, servingsPerMeal: 1, ingredients: [], steps: ['Cook.'], estMinutes: 30, actualMinutesHistory: [], cuisine,
    })
    const chip = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}\\d+$`) })
    const shown = () => [...document.querySelectorAll('[aria-label="Cuisines to prefer"] button')].map((x) => x.textContent?.replace(/\d+$/, ''))

    it('offers a handful of broad regions, with how many of your recipes are in each, starting from the everyday western ones', async () => {
      await seedIfEmpty()
      await db.settings.put({ ...DEFAULT_SETTINGS })
      // Spanish and Italian are both Southern European. Turkish is Mediterranean & Middle Eastern. The last has no cuisine.
      await db.recipes.bulkAdd([recipe('Paella', 'Spanish'), recipe('Lasagne', 'Italian'), recipe('Pizza', 'Italian'), recipe('Falafel', 'Turkish'), recipe('My stew')])
      open()
      const southern = await chip('Southern European')
      expect(southern.textContent).toBe('Southern European3')
      expect(southern.getAttribute('aria-pressed')).toBe('true')
      expect((await chip('Mediterranean & Middle Eastern')).textContent).toBe('Mediterranean & Middle Eastern1')
      expect((await chip('Mediterranean & Middle Eastern')).getAttribute('aria-pressed')).toBe('false')
      expect(shown()).toHaveLength(9) // not one button per cuisine
      expect(shown()).not.toContain('Italian')
    })

    it('lets you choose several, and saves each choice', async () => {
      await seedIfEmpty()
      await db.settings.put({ ...DEFAULT_SETTINGS, preferredCuisines: [] })
      open()
      fireEvent.click(await chip('Asian'))
      fireEvent.click(await chip('African'))
      await waitFor(async () => expect((await db.settings.get(1))!.preferredCuisines).toEqual(['African', 'Asian']))
      expect((await chip('Asian')).getAttribute('aria-pressed')).toBe('true')
      expect((await chip('British & Irish')).getAttribute('aria-pressed')).toBe('false')
      fireEvent.click(await chip('Asian')) // off again
      await waitFor(async () => expect((await db.settings.get(1))!.preferredCuisines).toEqual(['African']))
    })

    it('clears them all, which treats every cuisine equally', async () => {
      await seedIfEmpty()
      await db.settings.put({ ...DEFAULT_SETTINGS })
      open()
      fireEvent.click(await screen.findByRole('button', { name: 'Clear all' }))
      await waitFor(async () => expect((await db.settings.get(1))!.preferredCuisines).toEqual([]))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull())
      expect((await db.settings.get(1))!.preferFamiliar).toBe(false) // nothing to lean towards
    })

    it('brings older installs across: the on/off switch, and single cuisines saved before regions', async () => {
      const { withDefaults } = await import('./db')
      const { DEFAULT_REGIONS } = await import('./lib/cuisine')
      const { preferredCuisines: _a, ...base } = DEFAULT_SETTINGS
      void _a
      expect(withDefaults({ ...base, preferFamiliar: true }).preferredCuisines).toEqual(DEFAULT_REGIONS)
      expect(withDefaults({ ...base, preferFamiliar: false }).preferredCuisines).toEqual([])
      expect(withDefaults({ ...base, preferFamiliar: false }).preferFamiliar).toBe(false)
      // single cuisines become their regions, once each, in the usual order; unknown ones are dropped
      expect(withDefaults({ ...base, preferredCuisines: ['Thai', 'Italian', 'Spanish', 'Nowhere', 'Asian'] }).preferredCuisines).toEqual(['Southern European', 'Asian'])
      expect(withDefaults({ ...base, preferredCuisines: ['Asian'] }).preferredCuisines).toEqual(['Asian'])
    })
  })

  it('asks before replacing everything with a backup, and cancel changes nothing', async () => {
    await seedIfEmpty()
    open()
    const file = new File([JSON.stringify(await exportBackup())], 'b.json', { type: 'application/json' })
    fireEvent.change(await screen.findByLabelText('Backup file'), { target: { files: [file] } })
    expect(await screen.findByText(/replaces everything/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText(/replaces everything/i)).toBeNull())
  })

  it('tells you a wrong file is not a backup', async () => {
    await seedIfEmpty()
    open()
    fireEvent.change(await screen.findByLabelText('Backup file'), { target: { files: [new File(['{}'], 'x.json')] } })
    expect(await screen.findByText(/not a Meal Planner backup/)).toBeTruthy()
  })
})

describe('ready to install', () => {
  const icons = Object.keys(import.meta.glob('../public/icons/*.png')).map((p) => p.replace('../public/', ''))

  it('every icon the manifest names exists, and the app uses relative paths so it works in a subfolder', () => {
    expect(viteConfig).toContain("base: './'")
    const named = [...viteConfig.matchAll(/src: '(icons\/[^']+)'/g)].map((m) => m[1])
    expect(named.length).toBe(3)
    for (const path of named) expect(icons, path).toContain(path)
    expect(icons).toContain('icons/apple-touch-icon.png')
    expect(mainSource).toContain('HashRouter') // deep links work on a host with no rewrite rules
  })
})
