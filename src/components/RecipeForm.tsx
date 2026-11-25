import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPaste, Plus, Trash2 } from 'lucide-react'
import { db } from '../db'
import { recipeNutrition } from '../lib/nutrition'
import { parseIngredientBlockDetailed } from '../lib/parseIngredients'
import { classifyRecipe } from '../lib/recipeSafety'
import { tagLevelMap } from '../lib/sensitivity'
import { UNITS } from '../lib/units'
import type { Ingredient, Recipe, Sensitivity, Unit } from '../types'
import AddFoodSheet from './AddFoodSheet'
import IngredientPicker from './IngredientPicker'
import SafetyPanel from './SafetyPanel'

let lineKeyCounter = 0
/** Unique, stable React keys for ingredient lines. */
const nextKey = () => ++lineKeyCounter

interface Line {
  key: number
  ingredient: Ingredient | null
  qty: string
  unit: Unit
  /** What the pasted line said, to prefill the search when no food matched. */
  hint: string
  /** Why an amount or food is a guess, from the paste reader. Cleared once the user edits the amount. */
  note: string
}

export default function RecipeForm({
  initial,
  ingredients,
  tagRows,
  combinedCap,
  defaultLimit,
}: {
  initial?: Recipe
  ingredients: Ingredient[]
  tagRows: { tag: string; sensitivity: Sensitivity }[]
  combinedCap: number
  defaultLimit: number
}) {
  const navigate = useNavigate()
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id!, i])), [ingredients])
  const levels = useMemo(() => tagLevelMap(tagRows), [tagRows])

  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [servings, setServings] = useState(String(initial?.servings ?? 2))
  const [minutes, setMinutes] = useState(String(initial?.estMinutes ?? 30))
  const [steps, setSteps] = useState((initial?.steps ?? []).join('\n'))
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.ingredients ?? []).map((l) => ({
      key: nextKey(),
      ingredient: byId.get(l.ingredientId) ?? null,
      qty: String(l.qty),
      unit: l.unit,
      hint: '',
      note: '',
    })),
  )
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  /** Pasted lines that were headings or labels, not ingredients, so the user can see what was left out. */
  const [skipped, setSkipped] = useState<string[]>([])
  /** The ingredient line that is adding a new food, and what was typed. */
  const [newFood, setNewFood] = useState<{ key: number; name: string } | null>(null)

  const newLine = (): Line => ({ key: nextKey(), ingredient: null, qty: '', unit: 'g', hint: '', note: '' })
  const update = (key: number, changes: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...changes } : l)))

  const addPasted = () => {
    const { lines: parsed, skipped: ignored } = parseIngredientBlockDetailed(pasted, ingredients)
    setSkipped(ignored)
    setLines((ls) => {
      const next = ls.map((l) => ({ ...l }))
      for (const p of parsed) {
        const incoming: Line = {
          key: nextKey(),
          ingredient: p.match,
          qty: p.qty == null ? '' : String(p.qty),
          unit: p.unit,
          hint: p.match ? '' : p.text,
          note: p.match ? p.note : p.note || `Couldn't find “${p.text}” in your foods. Pick one, or choose the closest.`,
        }
        // the same food in the same unit as a line already here ("haddock" and "smoked haddock"): add them together
        const same =
          incoming.ingredient && Number(incoming.qty) > 0
            ? next.find((l) => l.ingredient?.id === incoming.ingredient!.id && l.unit === incoming.unit && Number(l.qty) > 0)
            : undefined
        if (same) {
          same.qty = String(Math.round((Number(same.qty) + Number(incoming.qty)) * 100) / 100)
          same.note = `Combined two lines of ${same.ingredient!.name.toLowerCase()}. Check the amount.`
        } else {
          next.push(incoming)
        }
      }
      return next
    })
    setPasted('')
    setPasting(false)
  }

  const valid = lines.filter((l) => l.ingredient && Number(l.qty) > 0)
  const preview = useMemo(() => {
    const recipe = {
      servings: Math.max(1, Number(servings) || 1),
      ingredients: valid.map((l) => ({ ingredientId: l.ingredient!.id!, qty: Number(l.qty), unit: l.unit })),
    }
    return { nutrition: recipeNutrition(recipe, byId), safety: classifyRecipe(recipe, byId, levels, combinedCap, defaultLimit) }
  }, [valid, servings, byId, levels, combinedCap, defaultLimit])

  const problem =
    title.trim() === ''
      ? 'Give the recipe a name.'
      : !(Number(servings) > 0)
        ? 'Enter how many servings it makes.'
        : lines.length === 0
          ? 'Add at least one ingredient.'
          : valid.length !== lines.length
            ? 'Every ingredient needs a food and an amount.'
            : ''

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (problem) return
    const recipe: Omit<Recipe, 'id'> = {
      title: title.trim(),
      servings: Number(servings),
      servingsPerMeal: initial?.servingsPerMeal ?? 1,
      ingredients: valid.map((l) => ({ ingredientId: l.ingredient!.id!, qty: Number(l.qty), unit: l.unit })),
      steps: steps.split('\n').map((s) => s.trim()).filter(Boolean),
      estMinutes: Number(minutes) > 0 ? Number(minutes) : 30,
      actualMinutesHistory: initial?.actualMinutesHistory ?? [],
      source: initial?.source,
      seedId: initial?.seedId,
      category: initial?.category,
      cuisine: initial?.cuisine,
      rating: initial?.rating,
      description: description.trim() || undefined,
      // Still a guess only if this was one and you left the number alone.
      servingsEstimated: initial ? initial.servingsEstimated === true && Number(servings) === initial.servings : undefined,
      // Same for the time: still a placeholder only if it was one and you left the number alone.
      timeEstimated: initial?.timeEstimated === undefined ? undefined : initial.timeEstimated && Number(minutes) === initial.estMinutes,
    }
    const id = initial?.id != null ? (await db.recipes.put({ ...recipe, id: initial.id }), initial.id) : await db.recipes.add(recipe)
    navigate(`/recipes/${id}`)
  }

  const n = preview.nutrition
  return (
    <form onSubmit={save} className="recipe-form">
      <header className="page-head">
        <h1>{initial ? 'Edit recipe' : 'New recipe'}</h1>
      </header>

      <div className="field">
        <label htmlFor="r-title">Name</label>
        <input id="r-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chicken and rice bowl" />
      </div>
      <div className="field">
        <label htmlFor="r-desc">What is it? (one sentence)</label>
        <input
          id="r-desc"
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={140}
          placeholder="Rice with grilled chicken, peppers and a quick sauce."
        />
      </div>
      <div className="dates">
        <div className="field">
          <label htmlFor="r-servings">Servings</label>
          <input id="r-servings" className="input" type="number" inputMode="decimal" min="1" step="any" value={servings} onChange={(e) => setServings(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="r-minutes">Minutes to cook</label>
          <input id="r-minutes" className="input" type="number" inputMode="numeric" min="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </div>
      </div>

      <div className="block-head">
        <h2>Ingredients</h2>
        <p>Use raw weights where you can. Calories and protein are calculated from raw foods.</p>
      </div>

      {lines.map((l) => (
        <div key={l.key} className="line">
          <IngredientPicker
            ingredients={ingredients}
            value={l.ingredient}
            initialQuery={l.hint}
            onPick={(i) => update(l.key, { ingredient: i, note: '' })}
            onClear={() => update(l.key, { ingredient: null, hint: '' })}
            onCreate={(name) => setNewFood({ key: l.key, name })}
          />
          <div className="line-amount">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              aria-label="Amount"
              placeholder="Amount"
              value={l.qty}
              onChange={(e) => update(l.key, { qty: e.target.value, note: '' })}
            />
            <select className="input" aria-label="Unit" value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value as Unit })}>
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove ${l.ingredient?.name ?? 'ingredient'}`}
              onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
            >
              <Trash2 size={20} aria-hidden />
            </button>
          </div>
          {l.note && <p className="line-note">{l.note}</p>}
        </div>
      ))}

      {skipped.length > 0 && (
        <p className="hint" role="status">
          Left out {skipped.length} {skipped.length === 1 ? 'line' : 'lines'} that {skipped.length === 1 ? "isn't an ingredient" : "aren't ingredients"}:{' '}
          {skipped.map((s) => `“${s}”`).join(', ')}.
        </p>
      )}

      {pasting ? (
        <div className="field paste">
          <label htmlFor="r-paste">Paste ingredients, one per line</label>
          <textarea
            id="r-paste"
            className="input"
            rows={6}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={'200 g white rice\n1 lb chicken breast\n3 cloves garlic, minced'}
          />
          <div className="actions">
            <button type="button" className="btn-primary" disabled={pasted.trim() === ''} onClick={addPasted}>
              Add to recipe
            </button>
            <button type="button" className="btn-quiet" onClick={() => setPasting(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="btn-outline" onClick={() => setLines((ls) => [...ls, newLine()])}>
            <Plus size={20} aria-hidden /> Add ingredient
          </button>
          <button type="button" className="btn-outline" onClick={() => setPasting(true)}>
            <ClipboardPaste size={20} aria-hidden /> Paste a list
          </button>
        </div>
      )}

      <div className="block-head">
        <h2>Steps</h2>
        <p>One step per line.</p>
      </div>
      <textarea className="input" rows={6} aria-label="Steps" value={steps} onChange={(e) => setSteps(e.target.value)} />

      <div className="block-head">
        <h2>Per serving</h2>
      </div>
      <div className="stats">
        <div>
          <span className="stat-num">{Math.round(n.proteinPerServing)}</span>
          <span className="stat-cap">g protein</span>
        </div>
        <div>
          <span className="stat-num">{Math.round(n.kcalPerServing)}</span>
          <span className="stat-cap">kcal</span>
        </div>
      </div>
      {n.uncounted.length > 0 && (
        <p className="hint">
          Not counted, because the amount has no known weight: {n.uncounted.map((i) => i.name).join(', ')}. Enter it in grams to include it.
        </p>
      )}
      <SafetyPanel safety={preview.safety} />

      {problem && <p className="hint">{problem}</p>}
      <button className="fab" type="submit" disabled={problem !== ''}>
        Save recipe
      </button>

      {newFood && (
        <AddFoodSheet
          initialName={newFood.name}
          onSaved={(food) => {
            update(newFood.key, { ingredient: food, note: '' })
            setNewFood(null)
          }}
          onClose={() => setNewFood(null)}
        />
      )}
    </form>
  )
}
