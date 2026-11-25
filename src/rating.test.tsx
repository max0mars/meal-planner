// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'
import recipeSeed from './data/recipes.seed.json'
import { db, MealPlannerDB } from './db'
import { nextRating, toggleRating } from './lib/rating'
import { seedIfEmpty } from './lib/seed'
import { seedBaselineRecipes } from './lib/seedRecipes'
import { useRecipeRows } from './lib/useRecipeRows'

const open = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

beforeAll(async () => {
  await seedIfEmpty()
  await seedBaselineRecipes()
})
afterEach(async () => {
  cleanup()
  for (const r of await db.recipes.toArray()) await db.recipes.update(r.id!, { rating: undefined })
})

const find = async (title: string) => (await db.recipes.where('title').equals(title).first())!

describe('like and dislike', () => {
  it('toggles: tap to set, tap again to clear, the other one switches', () => {
    expect(nextRating(undefined, 'like')).toBe('like')
    expect(nextRating('like', 'like')).toBeUndefined()
    expect(nextRating('like', 'dislike')).toBe('dislike')
    expect(nextRating('dislike', 'like')).toBe('like')
  })

  it('two quick taps are both counted (like, then dislike)', async () => {
    const r = await find('Lasagne')
    await Promise.all([toggleRating(r.id!, 'like'), toggleRating(r.id!, 'dislike')])
    expect((await db.recipes.get(r.id!))!.rating).toBe('dislike')
  })

  it('the buttons on a recipe store the rating and show it as pressed', async () => {
    const r = await find('Lasagne')
    open(`/recipes/${r.id}`)
    const like = await screen.findByRole('button', { name: /^Like$/ })
    expect(like.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(like)
    await waitFor(() => expect(screen.getByRole('button', { name: /^Like$/ }).getAttribute('aria-pressed')).toBe('true'))
    expect((await db.recipes.get(r.id!))!.rating).toBe('like')
    fireEvent.click(screen.getByRole('button', { name: /^Dislike$/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^Like$/ }).getAttribute('aria-pressed')).toBe('false'))
    expect((await db.recipes.get(r.id!))!.rating).toBe('dislike')
  })

  it('a disliked recipe is never offered to the planner, and a liked one is', async () => {
    const lasagne = await find('Lasagne')
    const { result } = renderHook(() => useRecipeRows())
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(result.current!.candidates.some((c) => c.recipe.id === lasagne.id)).toBe(true)
    await toggleRating(lasagne.id!, 'dislike')
    await waitFor(() => expect(result.current!.candidates.some((c) => c.recipe.id === lasagne.id)).toBe(false))
    expect(result.current!.rows.some((r) => r.recipe.id === lasagne.id)).toBe(true) // still listed and choosable by hand
    await toggleRating(lasagne.id!, 'like')
    await waitFor(() => expect(result.current!.candidates.some((c) => c.recipe.id === lasagne.id)).toBe(true))
  })

  it('"Liked" shows only liked recipes, and a disliked recipe sinks to the bottom of the list', async () => {
    const [a, b] = [await find('Lasagne'), await find('Ratatouille')]
    await toggleRating(a.id!, 'like')
    await toggleRating(b.id!, 'dislike')
    open('/recipes')
    fireEvent.click(await screen.findByRole('button', { name: /^Liked\d+$/ }))
    expect(await screen.findByText('Lasagne')).toBeTruthy()
    expect(screen.queryByText('Ratatouille')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Liked\d+$/ })) // off
    await waitFor(() => {
      const titles = [...document.querySelectorAll('.recipe-list > li .r-name')].map((e) => e.textContent)
      expect(titles.indexOf('Ratatouille')).toBe(titles.length - 1)
    })
  })

  it('"Your cuisines" hides recipes from other cuisines', async () => {
    open('/recipes')
    expect(await screen.findByText('Falafel')).toBeTruthy() // Turkish
    fireEvent.click(screen.getByRole('button', { name: /^Your cuisines\d+$/ }))
    await waitFor(() => expect(screen.queryByText('Falafel')).toBeNull())
    expect(screen.getByText('Lasagne')).toBeTruthy()
  })

  it('editing a recipe keeps its rating, cuisine and description', async () => {
    const r = await find('Lasagne')
    await toggleRating(r.id!, 'like')
    open(`/recipes/${r.id}/edit`)
    fireEvent.click(await screen.findByRole('button', { name: /save/i }))
    await waitFor(async () => expect((await db.recipes.get(r.id!))!.description).toBeTruthy())
    const after = (await db.recipes.get(r.id!))!
    expect(after).toMatchObject({ rating: 'like', cuisine: 'Italian' })
  })
})

describe('version 4 descriptions', () => {
  it('fills a missing description and cuisine but never replaces one you wrote', async () => {
    const database = new MealPlannerDB('desc-upgrade')
    await seedIfEmpty(database)
    await seedBaselineRecipes(database)
    const [plain, mine] = (await database.recipes.toArray()).filter((r) => r.seedId)
    await database.recipes.update(plain.id!, { description: undefined, cuisine: undefined })
    await database.recipes.update(mine.id!, { description: 'My own words.' })
    await database.settings.update(1, { baselineRecipesVersion: 3 })
    await seedBaselineRecipes(database)
    const seed = new Map(recipeSeed.map((s) => [s.seedId, s]))
    const a = (await database.recipes.get(plain.id!))!
    expect(a.description).toBe(seed.get(a.seedId!)!.description)
    expect(a.cuisine).toBe(seed.get(a.seedId!)!.cuisine)
    expect((await database.recipes.get(mine.id!))!.description).toBe('My own words.')
  })
})
