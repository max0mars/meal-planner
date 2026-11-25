import { useMemo, useState } from 'react'
import { NO_FILTERS, filterCounts, filterLabel, filterRows, isFiltering, type FilterContext, type FilterState, type FilterableRow } from './recipeFilters'

/** What the filter bar needs to draw itself and change the filters. */
export interface RecipeFilterControls {
  state: FilterState
  set: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void
  counts: ReturnType<typeof filterCounts>
  /** True when you have chosen any cuisines in Settings, so there is a "Your cuisines" button to show. */
  hasCuisines: boolean
  clear: () => void
}

/**
 * The state of the recipe filters and the recipes that pass them. One place for both screens that search recipes, so the
 * same buttons, the same numbers and the same order are always the same.
 */
export function useRecipeFilters<R extends FilterableRow>(rows: R[], ctx: FilterContext) {
  const [state, setState] = useState<FilterState>(NO_FILTERS)
  const { byId, preferredCuisines } = ctx
  const shown = useMemo(() => filterRows(rows, state, { byId, preferredCuisines }), [rows, state, byId, preferredCuisines])
  const counts = useMemo(() => filterCounts(rows, state, { byId, preferredCuisines }), [rows, state, byId, preferredCuisines])
  const controls: RecipeFilterControls = {
    state,
    set: (key, value) => setState((s) => ({ ...s, [key]: value })),
    counts,
    hasCuisines: preferredCuisines.length > 0,
    // clearing the filters keeps the sort you chose
    clear: () => setState((s) => ({ ...NO_FILTERS, byProtein: s.byProtein })),
  }
  return { ...controls, shown, filtering: isFiltering(state), label: filterLabel(state) }
}
