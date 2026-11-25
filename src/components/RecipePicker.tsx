import { useEffect, useId, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ThumbsDown, ThumbsUp, X } from 'lucide-react'
import { db } from '../db'
import { todayIso } from '../lib/pantry'
import { pantryMatch, pantryScore, type PantryMatch } from '../lib/pantryMatch'
import { suitsSlot, type Candidate } from '../lib/planner'
import { useRecipeFilters } from '../lib/useRecipeFilters'
import type { RecipeRow } from '../lib/useRecipeRows'
import RecipeFilterBar from './RecipeFilterBar'
import type { Ingredient, MealSlot } from '../types'

/**
 * A sheet for choosing a recipe for a meal: the same search, filters and sorting as the Recipes screen (one shared filter bar),
 * and only recipes you can cook (nothing Major in them). Before you type or filter, it suggests meals your
 * pantry can mostly make, putting food that is about to expire first.
 */
export default function RecipePicker({
  title,
  rows,
  byId,
  preferredCuisines,
  date,
  slot,
  onPick,
  onClose,
}: {
  title: string
  /** Recipes you can cook. */
  rows: RecipeRow[]
  byId: Map<number, Ingredient>
  /** The cuisine regions chosen in Settings, for the Your cuisines button. */
  preferredCuisines: string[]
  /** The day of the meal, so only food that is still good then counts. Defaults to today. */
  date?: string
  /** The meal, so a dessert is not suggested for dinner. */
  slot?: MealSlot
  onPick: (row: RecipeRow) => void
  onClose: () => void
}) {
  const uid = useId()
  const filters = useRecipeFilters(rows, { byId, preferredCuisines })
  const { shown, filtering } = filters
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    searchRef.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      before?.focus?.()
    }
  }, [])

  // Meals the pantry can mostly make. Only offered while no search or filter is on, and never a recipe you disliked.
  const pantry = useLiveQuery(() => db.pantryItems.toArray(), [])
  const suggestions = useMemo(() => {
    if (filtering || !pantry || pantry.length === 0) return []
    const today = todayIso()
    return rows
      .filter((r) => r.recipe.rating !== 'dislike')
      .filter((r) => !slot || suitsSlot({ recipe: r.recipe, perServing: { kcal: r.nutrition.kcalPerServing, protein: r.nutrition.proteinPerServing } } as Candidate, slot))
      .map((r) => {
        const match = pantryMatch(r.recipe, pantry, byId, date ?? today, today)
        return { row: r, match, score: pantryScore(match) }
      })
      .filter((x): x is { row: RecipeRow; match: PantryMatch; score: number } => x.score != null)
      .sort((a, b) => b.score - a.score || a.row.recipe.title.localeCompare(b.row.recipe.title))
      .slice(0, 5)
  }, [rows, pantry, byId, date, slot, filtering])

  const recipeRow = (r: RecipeRow, match?: PantryMatch) => (
    <li key={r.recipe.id} className={`recipe-row ${r.safety.status}${r.recipe.rating === 'dislike' ? ' disliked' : ''}`}>
      <button type="button" onClick={() => onPick(r)}>
        <span className="days">
          <span className="days-num">{Math.round(r.nutrition.proteinPerServing)}</span>
          <span className="days-cap">g protein</span>
        </span>
        <span className="pantry-body">
          <span className="r-name">
            {r.recipe.title}
            {r.recipe.rating === 'like' && <ThumbsUp size={16} className="rated like" aria-label="Liked" />}
            {r.recipe.rating === 'dislike' && <ThumbsDown size={16} className="rated" aria-label="Disliked" />}
          </span>
          {r.recipe.description && <span className="r-desc">{r.recipe.description}</span>}
          <span className="r-nums">
            <span>{Math.round(r.nutrition.kcalPerServing)} kcal</span>
            <span>{r.recipe.estMinutes} min</span>
          </span>
          {match && match.soon.length > 0 && <span className="pick-note soon">Uses up {match.soon.join(', ').toLowerCase()}</span>}
          {match && (
            <span className={`pick-note${match.missing.length === 0 ? ' all' : ''}`}>
              {match.missing.length === 0 ? 'You have everything' : `Missing ${match.missing.join(', ').toLowerCase()}`}
            </span>
          )}
          {r.safety.status === 'warn' && (
            <span className="pantry-flag light">Light: {r.safety.reasons.map((x) => x.ingredient.name.toLowerCase()).join(', ')}</span>
          )}
        </span>
      </button>
    </li>
  )

  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2 id={`${uid}-title`}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={24} aria-hidden />
          </button>
        </div>
        <RecipeFilterBar filters={filters} searchRef={searchRef} />
        {suggestions.length > 0 && (
          <>
            <h3 className="pick-heading">From your pantry</h3>
            <ul className="recipe-list picker-list">{suggestions.map((x) => recipeRow(x.row, x.match))}</ul>
            <h3 className="pick-heading">All recipes</h3>
          </>
        )}
        {shown.length === 0 ? (
          <p className="empty">{rows.length === 0 ? 'No recipes you can cook yet. Add one on the Recipes screen.' : 'No recipes match. Try a shorter search.'}</p>
        ) : (
          <ul className="recipe-list picker-list">{shown.map((r) => recipeRow(r))}</ul>
        )}
      </div>
    </div>,
    document.body,
  )
}
