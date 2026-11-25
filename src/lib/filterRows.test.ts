import { describe, expect, it } from 'vitest'
import {
  NO_FILTERS,
  filterCounts,
  filterLabel,
  filterRows,
  isFiltering,
  passesFilters,
  type DishId,
  type FilterContext,
  type FilterState,
  type FilterableRow,
  type KindId,
} from './recipeFilters'

const ctx: FilterContext = { byId: new Map(), preferredCuisines: ['British & Irish'] }
let n = 0
const row = (
  title: string,
  over: { kinds?: KindId[]; dishes?: DishId[]; protein?: number; rating?: 'like' | 'dislike'; cuisine?: string; excluded?: boolean } = {},
): FilterableRow => ({
  recipe: { title, category: undefined, ingredients: [], rating: over.rating, cuisine: over.cuisine ?? 'British' },
  kinds: new Set(over.kinds ?? []),
  dishes: new Set(over.dishes ?? []),
  nutrition: { proteinPerServing: over.protein ?? 10 + n++ },
  safety: { status: over.excluded ? 'excluded' : 'safe' },
})
const state = (over: Partial<FilterState> = {}): FilterState => ({ ...NO_FILTERS, ...over })

const rows = [
  row('Beef pasta', { kinds: ['beef'], dishes: ['pasta'], protein: 40, cuisine: 'Italian' }),
  row('Chicken pasta', { kinds: ['chicken'], dishes: ['pasta'], protein: 35, cuisine: 'Italian' }),
  row('Beef stew', { kinds: ['beef'], protein: 45 }),
  row('Tomato soup', { kinds: ['vegetarian'], dishes: ['soup'], protein: 6, rating: 'like' }),
  row('Chicken rice bowl', { kinds: ['chicken'], dishes: ['riceBowl'], protein: 38, rating: 'dislike' }),
  row('Hidden beef pasta', { kinds: ['beef'], dishes: ['pasta'], excluded: true }),
]
const titles = (list: FilterableRow[]) => list.map((r) => r.recipe.title)

describe('filtering recipes', () => {
  it('shows everything A to Z with nothing on, the recipes you dislike last', () => {
    expect(titles(filterRows(rows, state(), ctx))).toEqual(['Beef pasta', 'Beef stew', 'Chicken pasta', 'Hidden beef pasta', 'Tomato soup', 'Chicken rice bowl'])
  })

  it('sorts by protein when asked, the disliked still last', () => {
    expect(titles(filterRows(rows, state({ byProtein: true }), ctx))).toEqual(['Beef stew', 'Beef pasta', 'Chicken pasta', 'Hidden beef pasta', 'Tomato soup', 'Chicken rice bowl'])
  })

  it('combines a main ingredient with a dish type', () => {
    expect(titles(filterRows(rows, state({ kind: 'beef', dish: 'pasta' }), ctx))).toEqual(['Beef pasta', 'Hidden beef pasta'])
    expect(titles(filterRows(rows, state({ dish: 'soup' }), ctx))).toEqual(['Tomato soup'])
  })

  it('shows only liked recipes, or only your cuisines', () => {
    expect(titles(filterRows(rows, state({ only: 'liked' }), ctx))).toEqual(['Tomato soup'])
    // British is in "British & Irish"; Italian is not
    expect(titles(filterRows(rows, state({ only: 'familiar' }), ctx))).not.toContain('Beef pasta')
    expect(titles(filterRows(rows, state({ only: 'familiar' }), ctx))).toContain('Beef stew')
  })

  it('searches, and a search narrows the same list the buttons do', () => {
    // the words match titles here (these test rows have no ingredients), and the Chicken button narrows the result too
    expect(titles(filterRows(rows, state({ query: 'pasta' }), ctx))).toEqual(['Beef pasta', 'Chicken pasta', 'Hidden beef pasta'])
    expect(titles(filterRows(rows, state({ query: 'pasta', kind: 'chicken' }), ctx))).toEqual(['Chicken pasta'])
    expect(titles(filterRows(rows, state({ query: 'soup', kind: 'chicken' }), ctx))).toEqual([])
    expect(passesFilters(rows[0], state({ kind: 'beef' }), ctx)).toBe(true)
    expect(passesFilters(rows[0], state({ kind: 'chicken' }), ctx)).toBe(false)
  })

  it('says whether anything is narrowing the list, not counting the sort', () => {
    expect(isFiltering(state())).toBe(false)
    expect(isFiltering(state({ byProtein: true }))).toBe(false)
    expect(isFiltering(state({ kind: 'beef' }))).toBe(true)
    expect(isFiltering(state({ dish: 'soup' }))).toBe(true)
    expect(isFiltering(state({ only: 'liked' }))).toBe(true)
    expect(isFiltering(state({ query: '  ' }))).toBe(false)
    expect(isFiltering(state({ query: 'rice' }))).toBe(true)
  })

  it('describes the filters in words', () => {
    expect(filterLabel(state())).toBe('')
    expect(filterLabel(state({ kind: 'beef', dish: 'pasta' }))).toBe('beef pasta')
    expect(filterLabel(state({ dish: 'riceBowl' }))).toBe('rice bowl')
  })
})

describe('the numbers on the buttons', () => {
  it('count recipes you can cook, leaving out those hidden by your sensitivities', () => {
    const c = filterCounts(rows, state(), ctx)
    expect(c.kind.beef).toBe(2) // not the hidden one
    expect(c.dish.pasta).toBe(2)
    expect(c.dish.soup).toBe(1)
    expect(c.only.liked).toBe(1)
  })

  it('adjust to the other filters: with Beef on, Pasta counts beef pastas', () => {
    const c = filterCounts(rows, state({ kind: 'beef' }), ctx)
    expect(c.dish.pasta).toBe(1)
    expect(c.dish.soup).toBe(0)
    expect(c.dish.riceBowl).toBe(0)
  })

  it('and the other way: with Pasta on, the main ingredients count pastas', () => {
    const c = filterCounts(rows, state({ dish: 'pasta' }), ctx)
    expect(c.kind.beef).toBe(1)
    expect(c.kind.chicken).toBe(1)
    expect(c.kind.vegetarian).toBe(0)
  })

  it('leave a group\'s own filter out, so its buttons show what tapping them would give', () => {
    const c = filterCounts(rows, state({ kind: 'beef' }), ctx)
    expect(c.kind.chicken).toBe(2) // Chicken is not narrowed by the Beef choice in its own group
    expect(c.kind.beef).toBe(2)
  })

  it('follow a search too', () => {
    const c = filterCounts(rows, state({ query: 'soup' }), ctx)
    expect(c.dish.soup).toBe(1)
    expect(c.dish.pasta).toBe(0)
  })
})
