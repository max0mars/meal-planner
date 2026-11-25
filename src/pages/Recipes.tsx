import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, ThumbsDown, ThumbsUp } from 'lucide-react'
import RecipeFilterBar from '../components/RecipeFilterBar'
import { recipeNutrition } from '../lib/nutrition'
import type { Ingredient } from '../types'
import { useRecipeFilters } from '../lib/useRecipeFilters'
import { classifyRecipe, pct } from '../lib/recipeSafety'
import { useRecipeRows } from '../lib/useRecipeRows'
import type { Recipe } from '../types'

const NONE: never[] = []
const NO_INGREDIENTS = new Map<number, Ingredient>()

export default function Recipes() {
  const kitchen = useRecipeRows()
  const [showHidden, setShowHidden] = useState(false)
  const rows = kitchen?.rows ?? NONE
  const filters = useRecipeFilters(rows, { byId: kitchen?.data.byId ?? NO_INGREDIENTS, preferredCuisines: kitchen?.data.settings.preferredCuisines ?? NONE })

  if (!kitchen) return <p className="muted">Loading…</p>

  const { shown, filtering, label: kindLabel, clear: clearFilters } = filters
  const query = filters.state.query
  const offered = shown.filter((r) => r.safety.status !== 'excluded')
  const hidden = shown.filter((r) => r.safety.status === 'excluded')
  const offeredTotal = rows.filter((r) => r.safety.status !== 'excluded').length
  const hiddenTotal = rows.length - offeredTotal

  return (
    <section>
      <header className="page-head">
        <h1>Recipes</h1>
        {rows.length === 0 ? (
          <p className="lede">
            No recipes yet. Add one with its ingredients and the app works out calories and protein per serving, and checks it against your
            sensitivities.
          </p>
        ) : (
          <p className="summary">
            {offeredTotal} to cook.
            {hiddenTotal > 0 && <span className="avoid"> {hiddenTotal} hidden by your sensitivities.</span>}
          </p>
        )}
      </header>

      {rows.length > 0 && <RecipeFilterBar filters={filters} />}

      {rows.length > 0 && filtering && shown.length > 0 && (
        <p className="hint" role="status">
          Showing {shown.length} of {rows.length}.{' '}
          <button className="btn-quiet" onClick={clearFilters}>
            Clear filters
          </button>
        </p>
      )}

      {rows.length > 0 && shown.length === 0 && (
        <p className="empty" role="status">
          No {kindLabel ? `${kindLabel} ` : ''}recipes{query.trim() ? ` match “${query.trim()}”` : ' here'}.{' '}
          {query.trim() ? 'Try a shorter search, or ' : 'Try '}
          <button className="btn-quiet" onClick={clearFilters}>
            {query.trim() ? 'clear the filters' : 'clearing the filter'}
          </button>
          .
        </p>
      )}

      {offered.length > 0 && (
        <ul className="recipe-list">
          {offered.map((r) => (
            <RecipeRow key={r.recipe.id} {...r} />
          ))}
        </ul>
      )}

      {hidden.length > 0 && (
        <div className="group">
          <button className="btn-quiet" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? 'Hide' : 'Show'} the {hidden.length} I should avoid{query.trim() ? ' in this search' : ''}
          </button>
          {showHidden && (
            <ul className="recipe-list">
              {hidden.map((r) => (
                <RecipeRow key={r.recipe.id} {...r} />
              ))}
            </ul>
          )}
        </div>
      )}

      <Link to="/recipes/new" className="fab">
        <Plus size={24} aria-hidden />
        New recipe
      </Link>
    </section>
  )
}

function RecipeRow({
  recipe,
  nutrition,
  safety,
}: {
  recipe: Recipe
  nutrition: ReturnType<typeof recipeNutrition>
  safety: ReturnType<typeof classifyRecipe>
}) {
  const flagged = safety.reasons.map((r) => r.ingredient.name.toLowerCase())
  return (
    <li className={`recipe-row ${safety.status}${recipe.rating === 'dislike' ? ' disliked' : ''}`}>
      <Link to={`/recipes/${recipe.id}`}>
        <span className="days">
          <span className="days-num">{Math.round(nutrition.proteinPerServing)}</span>
          <span className="days-cap">g protein</span>
        </span>
        <span className="pantry-body">
          <span className="r-name">
            {recipe.title}
            {recipe.rating === 'like' && <ThumbsUp size={16} className="rated like" aria-label="Liked" />}
            {recipe.rating === 'dislike' && <ThumbsDown size={16} className="rated" aria-label="Disliked" />}
          </span>
          {recipe.description && <span className="r-desc">{recipe.description}</span>}
          <span className="r-nums">
            <span>{Math.round(nutrition.kcalPerServing)} kcal</span>
            <span>{recipe.estMinutes} min</span>
            <span>
              {recipe.servings} {recipe.servings === 1 ? 'serving' : 'servings'}
              {recipe.servingsEstimated ? ' (guess)' : ''}
            </span>
          </span>
          {safety.status === 'warn' && <span className="pantry-flag light">Light: {flagged.join(', ')}</span>}
          {safety.status === 'excluded' && (
            <span className="pantry-flag major">
              Avoid: {safety.reasons.filter((r) => r.kind !== 'light-ok').map((r) => r.ingredient.name.toLowerCase()).join(', ') ||
                `Light foods add up to ${pct(safety.combined?.share ?? 0)}`}
            </span>
          )}
        </span>
      </Link>
    </li>
  )
}
