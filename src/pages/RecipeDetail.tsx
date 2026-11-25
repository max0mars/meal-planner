import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { readBackTo } from '../lib/backTo'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeft, ExternalLink, Pencil, Plus } from 'lucide-react'
import RatingButtons from '../components/RatingButtons'
import SafetyPanel from '../components/SafetyPanel'
import ScalePanel from '../components/ScalePanel'
import { db } from '../db'
import { recipeNutrition } from '../lib/nutrition'
import { mergeDuplicateLines } from '../lib/mergeLines'
import { unlistedStaples } from '../lib/recipeHints'
import { classifyRecipe } from '../lib/recipeSafety'
import { factorForServings, formatAmount, lineCoverage } from '../lib/scaling'
import { effectiveSensitivity } from '../lib/sensitivity'
import { todayIso } from '../lib/pantry'
import { toGrams } from '../lib/units'
import { useKitchenData } from '../lib/useKitchenData'

export default function RecipeDetail() {
  const { id } = useParams()
  const recipeId = Number(id)
  const navigate = useNavigate()
  // opened from the plan or Today: the back button returns there
  const cameFrom = readBackTo(useLocation().state)
  // null = not found; undefined = still loading.
  const recipe = useLiveQuery(async () => (await db.recipes.get(recipeId)) ?? null, [recipeId])
  const data = useKitchenData()
  const [confirming, setConfirming] = useState(false)
  // How many servings you want to cook, or null for the recipe as written. Only changes what is shown.
  const [target, setTarget] = useState<number | null>(null)
  const allPantry = useLiveQuery(() => db.pantryItems.toArray(), [])
  // food that has gone off does not count towards what you have
  const pantry = useMemo(() => allPantry?.filter((p) => p.expiresOn >= todayIso()), [allPantry])

  const view = useMemo(() => {
    if (!recipe || !data) return null
    const factor = target == null ? 1 : factorForServings(target, recipe.servings)
    // a food named on two lines reads as one ingredient (the numbers are unchanged)
    const merged = mergeDuplicateLines(recipe.ingredients, data.byId)
    return {
      merged,
      nutrition: recipeNutrition(recipe, data.byId),
      safety: classifyRecipe(recipe, data.byId, data.levels, data.combinedCap, data.defaultLimit),
      unlisted: unlistedStaples(recipe, data.ingredients),
      factor,
      // each ingredient at the amount you are cooking, with how your pantry covers it
      rows: merged.flatMap((original) => {
        const food = data.byId.get(original.ingredientId)
        if (!food) return []
        const line = { ...original, qty: original.qty * factor }
        return [{ original, line, food, grams: toGrams(line.qty, line.unit, food), coverage: lineCoverage(line, pantry ?? [], data.byId) }]
      }),
    }
  }, [recipe, data, target, pantry])

  if (recipe === undefined || !data) return <p className="muted">Loading…</p>
  if (recipe === null || !view) {
    return (
      <section>
        <header className="page-head">
          <h1>Recipe not found</h1>
          <p className="lede">It may have been deleted.</p>
        </header>
        <Link to="/recipes" className="btn-quiet">
          Back to recipes
        </Link>
      </section>
    )
  }

  const { nutrition: n, safety, rows, unlisted, factor, merged } = view
  const havePantry = (pantry?.length ?? 0) > 0
  const setServings = (servings: number) => db.recipes.update(recipeId, { servings, servingsEstimated: false })
  return (
    <section>
      <Link
        to={cameFrom?.from ?? '/recipes'}
        className="back"
        onClick={(e) => {
          // step back in history rather than adding another entry, so back keeps working as you expect
          if (cameFrom) {
            e.preventDefault()
            navigate(-1)
          }
        }}
      >
        <ArrowLeft size={20} aria-hidden /> {cameFrom?.label ?? 'Recipes'}
      </Link>
      <header className="page-head">
        <h1>{recipe.title}</h1>
        {recipe.description && <p className="r-desc">{recipe.description}</p>}
        <RatingButtons recipeId={recipeId} rating={recipe.rating} />
        {recipe.seedId && (
          <p className="hint">
            A starter recipe{recipe.category ? ` (${recipe.category.toLowerCase()})` : ''}.{' '}
            {recipe.servingsEstimated
              ? 'The number of servings is a guess, and calories and protein per serving depend on it, so check the original recipe and use Edit serving size below.'
              : 'The servings come from the original recipe.'}
            {recipe.timeEstimated !== false && ' The cooking time is an estimate.'}
          </p>
        )}
        {recipe.source && /^https?:\/\//.test(recipe.source) && (
          <a className="source-link" href={recipe.source} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={16} aria-hidden /> Original recipe
          </a>
        )}
      </header>

      <div className="stats">
        <div>
          <span className="stat-num">{Math.round(n.proteinPerServing)}</span>
          <span className="stat-cap">g protein per serving</span>
        </div>
        <div>
          <span className="stat-num">{Math.round(n.kcalPerServing)}</span>
          <span className="stat-cap">kcal per serving</span>
        </div>
        <div>
          <span className="stat-num">{recipe.estMinutes}</span>
          <span className="stat-cap">minutes</span>
        </div>
      </div>

      <SafetyPanel safety={safety} />

      {unlisted.map((u) => {
        const level = effectiveSensitivity(u.ingredient, data.levels).level
        const grams = u.gramsPerServing * recipe.servings
        return (
          <div key={u.ingredient.id} className={`safety ${level === 'major' ? 'excluded' : 'warn'}`}>
            <p>
              The steps say to serve with {u.mention}, but it isn&apos;t in the ingredients, so its calories and protein are left out.
              {level !== 'safe' &&
                ` ${u.ingredient.name} is a ${level === 'major' ? 'Major' : 'Light'} sensitivity for you, and the safety check above can't see it until it is added.`}
            </p>
            <button
              className="btn-outline"
              onClick={() =>
                db.recipes.update(recipeId, { ingredients: [...recipe.ingredients, { ingredientId: u.ingredient.id!, qty: grams, unit: 'g' }] })
              }
            >
              <Plus size={20} aria-hidden /> Add {grams} g {u.ingredient.name.toLowerCase()} ({recipe.servings} × {u.gramsPerServing} g raw)
            </button>
          </div>
        )
      })}

      <div className="block-head">
        <h2>Ingredients</h2>
      </div>
      <ScalePanel
        servings={recipe.servings}
        lines={merged}
        byId={data.byId}
        pantry={pantry ?? []}
        target={target}
        onTarget={setTarget}
        kcalPerServing={n.kcalPerServing}
        proteinPerServing={n.proteinPerServing}
        estimated={!!recipe.servingsEstimated}
        onSetServings={setServings}
      />
      <ul className="rows">
        {rows.map(({ original, line, food, grams, coverage }, i) => {
          const eff = effectiveSensitivity(food, data.levels)
          return (
            <li key={i} className={`row ${eff.level}`}>
              <div className="r-name">{food.name}</div>
              <div className="r-nums">
                <span>{formatAmount(line.qty, line.unit)}</span>
                {line.unit !== 'g' && grams != null && <span>{formatAmount(grams, 'g')}</span>}
                {factor !== 1 && <span className="was">recipe: {formatAmount(original.qty, original.unit)}</span>}
                {eff.level !== 'safe' && <span>{eff.level === 'major' ? 'Major' : 'Light'} sensitivity</span>}
              </div>
              {havePantry && coverage.status === 'enough' && <div className="stock ok">In your pantry: {formatAmount(coverage.haveGrams!, 'g')}</div>}
              {havePantry && coverage.status === 'short' && (
                <div className="stock short">
                  Short by {formatAmount(coverage.shortByGrams!, 'g')}. You have {formatAmount(coverage.haveGrams!, 'g')}.
                </div>
              )}
              {havePantry && coverage.status === 'none' && <div className="stock none">Not in your pantry</div>}
            </li>
          )
        })}
      </ul>
      {n.uncounted.length > 0 && (
        <p className="hint">
          Calories leave out {n.uncounted.map((i) => i.name).join(', ')}, because its amount has no known weight. Edit the recipe and enter it
          in grams.
        </p>
      )}

      {recipe.steps.length > 0 && (
        <>
          <div className="block-head">
            <h2>Steps</h2>
          </div>
          <ol className="steps">
            {recipe.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </>
      )}

      <div className="actions detail-actions">
        {confirming ? (
          <>
            <button
              className="btn-remove"
              onClick={async () => {
                await db.recipes.delete(recipeId)
                navigate('/recipes')
              }}
            >
              Yes, delete recipe
            </button>
            <button className="btn-quiet" onClick={() => setConfirming(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button className="btn-quiet" onClick={() => setConfirming(true)}>
            Delete recipe
          </button>
        )}
      </div>

      <Link to={`/recipes/${recipeId}/edit`} className="fab">
        <Pencil size={24} aria-hidden />
        Edit recipe
      </Link>
    </section>
  )
}
