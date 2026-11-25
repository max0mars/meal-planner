import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardPaste, Plus, Trash2, X } from 'lucide-react'
import { CATEGORY_BY_ID } from '../data/categories'
import { db } from '../db'
import { resolveRecipe } from '../lib/flexible'
import { recipeNutrition } from '../lib/nutrition'
import { parseIngredientBlockDetailed } from '../lib/parseIngredients'
import { classifyRecipe } from '../lib/recipeSafety'
import { tagLevelMap } from '../lib/sensitivity'
import { UNITS } from '../lib/units'
import type { Ingredient, Recipe, RecipeIngredient, Sensitivity, Unit } from '../types'
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
  /** The recipe works without it. */
  optional: boolean
  /** Flexible: other foods can be used instead (see src/lib/flexible.ts). */
  flexible: boolean
  /** Any food in the chosen food's category can be used. */
  anyCategory: boolean
  /** Other foods that can be used. */
  anyOf: Ingredient[]
  /** What the flexible line is called ("Meat"). */
  label: string
  /** You picked this food on the recipe page, so it is used rather than chosen for you. */
  picked: boolean
  /** An optional food you make the recipe without (set on the recipe page). */
  leftOut: boolean
}

/** A form line as it is saved. The flexible details are only kept while the line is flexible. */
function toSaved(l: Line): RecipeIngredient {
  const line: RecipeIngredient = { ingredientId: l.ingredient!.id!, qty: Number(l.qty), unit: l.unit }
  if (l.optional) line.optional = true
  if (l.flexible) {
    if (l.anyCategory && l.ingredient) line.anyCategory = l.ingredient.category
    const others = l.anyOf.map((f) => f.id!).filter((id) => id !== line.ingredientId)
    if (others.length > 0) line.anyOf = others
    if (l.label.trim() && (line.anyCategory || line.anyOf)) line.label = l.label.trim()
    if (l.picked && (line.anyCategory || line.anyOf)) line.picked = true
    if (l.optional && l.leftOut) line.leftOut = true
  }
  return line
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
      optional: !!l.optional,
      flexible: !!l.anyCategory || (l.anyOf?.length ?? 0) > 0,
      anyCategory: !!l.anyCategory,
      anyOf: (l.anyOf ?? []).map((id) => byId.get(id)).filter((f): f is Ingredient => !!f),
      label: l.label ?? '',
      picked: !!l.picked,
      leftOut: !!l.leftOut,
    })),
  )
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  /** Pasted lines that were headings or labels, not ingredients, so the user can see what was left out. */
  const [skipped, setSkipped] = useState<string[]>([])
  /** The ingredient line that is adding a new food, and what was typed. */
  const [newFood, setNewFood] = useState<{ key: number; name: string } | null>(null)

  const blank = { optional: false, flexible: false, anyCategory: false, anyOf: [] as Ingredient[], label: '', picked: false, leftOut: false }
  const newLine = (): Line => ({ key: nextKey(), ingredient: null, qty: '', unit: 'g', hint: '', note: '', ...blank })
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
          ...blank,
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
    // flexible lines are counted as their safest choice, and optional lines you should not eat are left out
    const { recipe } = resolveRecipe({ servings: Math.max(1, Number(servings) || 1), ingredients: valid.map(toSaved) }, { byId, levels })
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
            : lines.some((l) => l.flexible && !l.anyCategory && l.anyOf.length === 0)
              ? 'A flexible ingredient needs at least one other food, or “Any”.'
              : ''

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (problem) return
    const recipe: Omit<Recipe, 'id'> = {
      title: title.trim(),
      servings: Number(servings),
      servingsPerMeal: initial?.servingsPerMeal ?? 1,
      ingredients: valid.map(toSaved),
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
          <div className="line-flags">
            <label className="check">
              <input type="checkbox" checked={l.optional} onChange={(e) => update(l.key, { optional: e.target.checked })} /> Optional
            </label>
            <label className="check">
              <input type="checkbox" checked={l.flexible} onChange={(e) => update(l.key, { flexible: e.target.checked })} /> Flexible: other foods can be
              used
            </label>
          </div>
          {l.flexible && (
            <div className="line-flex">
              <div className="field">
                <label htmlFor={`flex-label-${l.key}`}>Name for this ingredient</label>
                <input
                  id={`flex-label-${l.key}`}
                  className="input"
                  value={l.label}
                  onChange={(e) => update(l.key, { label: e.target.value })}
                  placeholder={l.anyCategory && l.ingredient ? CATEGORY_BY_ID.get(l.ingredient.category)?.label ?? 'Meat' : 'Pasta sauce'}
                />
              </div>
              {l.ingredient && (
                <label className="check">
                  <input type="checkbox" checked={l.anyCategory} onChange={(e) => update(l.key, { anyCategory: e.target.checked })} /> Any{' '}
                  {(CATEGORY_BY_ID.get(l.ingredient.category)?.label ?? l.ingredient.category).toLowerCase()}
                </label>
              )}
              <p className="hint">{l.anyCategory ? 'Or also these foods:' : 'Or any of these foods:'}</p>
              {l.anyOf.length > 0 && (
                <ul className="flex-chips">
                  {l.anyOf.map((f) => (
                    <li key={f.id} className="flex-chip">
                      {f.name}
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`Remove ${f.name} as a choice`}
                        onClick={() => update(l.key, { anyOf: l.anyOf.filter((x) => x.id !== f.id) })}
                      >
                        <X size={16} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <IngredientPicker
                key={l.anyOf.length}
                label="Add a choice"
                ingredients={ingredients.filter((f) => f.id !== l.ingredient?.id && !l.anyOf.some((x) => x.id === f.id))}
                value={null}
                onPick={(f) => update(l.key, { anyOf: [...l.anyOf, f] })}
                onClear={() => {}}
              />
              {!l.anyCategory && l.anyOf.length === 0 && <p className="hint">Add at least one other food, or tick “Any”.</p>}
            </div>
          )}
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
