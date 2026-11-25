import type { Ref } from 'react'
import { DISH_FILTERS, KIND_FILTERS } from '../lib/recipeFilters'
import type { RecipeFilterControls } from '../lib/useRecipeFilters'

/**
 * The search box and every filter and sort button for recipes: main ingredient, dish type, your cuisines, liked, and most
 * protein. The Recipes screen and the plan's recipe picker both show this, so they never drift apart.
 */
export default function RecipeFilterBar({ filters, searchRef }: { filters: RecipeFilterControls; searchRef?: Ref<HTMLInputElement> }) {
  const { state, set, counts, hasCuisines } = filters
  const toggle = <K extends 'kind' | 'dish' | 'only'>(key: K, value: NonNullable<(typeof state)[K]>) => set(key, state[key] === value ? null : value)
  return (
    <>
      <input
        ref={searchRef}
        className="search"
        type="search"
        placeholder="Search recipes or ingredients"
        aria-label="Search recipes"
        value={state.query}
        onChange={(e) => set('query', e.target.value)}
      />
      <div className="filters" role="group" aria-label="Filter by main ingredient">
        {KIND_FILTERS.map((k) => (
          <button key={k.id} aria-pressed={state.kind === k.id} className={state.kind === k.id ? 'on' : ''} onClick={() => toggle('kind', k.id)}>
            {k.label}
            <span className="count">{counts.kind[k.id]}</span>
          </button>
        ))}
      </div>
      <div className="filters filters-dish" role="group" aria-label="Filter by dish type">
        {DISH_FILTERS.map((d) => (
          <button key={d.id} aria-pressed={state.dish === d.id} className={state.dish === d.id ? 'on' : ''} onClick={() => toggle('dish', d.id)}>
            {d.label}
            <span className="count">{counts.dish[d.id]}</span>
          </button>
        ))}
      </div>
      {hasCuisines && (
        <div className="filters" role="group" aria-label="Show only your cuisines">
          <button aria-pressed={state.only === 'familiar'} className={state.only === 'familiar' ? 'on' : ''} onClick={() => toggle('only', 'familiar')}>
            Your cuisines
            <span className="count">{counts.only.familiar}</span>
          </button>
        </div>
      )}
      <div className="filters" role="group" aria-label="Liked recipes and sorting">
        <button aria-pressed={state.only === 'liked'} className={state.only === 'liked' ? 'on' : ''} onClick={() => toggle('only', 'liked')}>
          Liked
          <span className="count">{counts.only.liked}</span>
        </button>
        <span className="filter-divider" aria-hidden />
        <button aria-pressed={state.byProtein} className={state.byProtein ? 'on' : ''} onClick={() => set('byProtein', !state.byProtein)}>
          Most protein
        </button>
      </div>
    </>
  )
}
