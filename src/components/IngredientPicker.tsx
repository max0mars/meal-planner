import { useId, useMemo, useState } from 'react'
import { searchIngredients } from '../lib/pantry'
import type { Ingredient } from '../types'

/** Search box that resolves to one of your foods. Shows the chosen food with a Change button. */
export default function IngredientPicker({
  ingredients,
  value,
  initialQuery = '',
  onPick,
  onClear,
  onCreate,
  label = 'Food',
}: {
  ingredients: Ingredient[]
  value: Ingredient | null
  initialQuery?: string
  onPick: (i: Ingredient) => void
  onClear: () => void
  /** Called with what was typed, to add it as a new food. Omit to hide the option. */
  onCreate?: (name: string) => void
  label?: string
}) {
  const [query, setQuery] = useState(initialQuery)
  const id = useId()
  const matches = useMemo(() => searchIngredients(ingredients, query), [ingredients, query])

  if (value) {
    return (
      <div className="picked">
        <span className="picked-name">{value.name}</span>
        <button type="button" className="btn-quiet" onClick={onClear} aria-label={`Change ${value.name}`}>
          Change
        </button>
      </div>
    )
  }

  const typed = query.trim()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="input"
        type="search"
        autoComplete="off"
        placeholder="Search foods"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {typed !== '' && (
        <ul className="suggest">
          {matches.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => onPick(m)}>
                {m.name}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="suggest-none">No match. Try a simpler word.</li>}
          {onCreate && (
            <li>
              <button type="button" className="suggest-add" onClick={() => onCreate(typed)}>
                Not here? Add “{typed}” as a new food
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
