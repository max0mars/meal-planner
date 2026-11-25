import { useId, useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { factorForServings, formatAmount, formatServings, pantryCapacity, pantryGrams } from '../lib/scaling'
import { toGrams } from '../lib/units'
import type { Ingredient, PantryItem, RecipeIngredient } from '../types'

const UNIT_WORD: Record<string, string> = { g: 'g', ml: 'ml', piece: 'pieces', tsp: 'tsp', tbsp: 'tbsp', cup: 'cups' }

/**
 * One servings control: how many servings you are cooking, which scales every amount (or scale by how much of one
 * ingredient you have). That only ever changes what is shown. "Edit serving size" changes how many servings the recipe itself
 * makes, which is what calories and protein per serving are worked out from, and is saved.
 * `target` is the servings you want to cook, or null for the recipe as written.
 */
export default function ScalePanel({
  servings,
  lines,
  byId,
  pantry,
  target,
  onTarget,
  kcalPerServing,
  proteinPerServing,
  estimated,
  onSetServings,
}: {
  servings: number
  lines: RecipeIngredient[]
  byId: Map<number, Ingredient>
  pantry: PantryItem[]
  target: number | null
  onTarget: (servings: number | null) => void
  kcalPerServing: number
  proteinPerServing: number
  /** True while the recipe's servings are the app's guess. */
  estimated: boolean
  /** Saves a new number of servings for the recipe itself. */
  onSetServings: (servings: number) => void
}) {
  const cooking = target ?? servings
  const changed = target !== null && Math.abs(target - servings) > 0.001
  const amountId = useId()
  const [pickedIndex, setPickedIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [have, setHave] = useState('')

  // Lines that can sensibly limit a batch: real foods with a weight, not seasonings or water.
  const usable = useMemo(
    () =>
      lines
        .map((line, index) => ({ line, index, food: byId.get(line.ingredientId) }))
        .filter(
          (x): x is { line: RecipeIngredient; index: number; food: Ingredient } =>
            !!x.food && x.food.category !== 'spices-herbs' && !/^(water|salt)\b/i.test(x.food.name) && toGrams(x.line.qty, x.line.unit, x.food) != null,
        ),
    [lines, byId],
  )
  const picked = usable.find((u) => u.index === pickedIndex) ?? usable[0]
  const capacity = useMemo(() => pantryCapacity(lines, pantry, byId), [lines, pantry, byId])
  const inPantry = picked ? pantryGrams(picked.line.ingredientId, pantry, byId) : null
  const pickedGrams = picked ? toGrams(picked.line.qty, picked.line.unit, picked.food) : null

  const step = (direction: 1 | -1) => {
    const next = direction === 1 ? Math.floor(cooking + 1e-9) + 1 : Math.ceil(cooking - 1e-9) - 1
    onTarget(Math.max(1, next))
  }

  const haveNumber = Number(have)
  const scaleToHave = () => {
    if (!picked || !(haveNumber > 0)) return
    onTarget((haveNumber / picked.line.qty) * servings)
    setHave('')
  }

  return (
    <div className="scale">
      <div className="scale-main">
        <span className="scale-label" id={`${amountId}-label`}>
          Servings{estimated ? ' (guess)' : ''}
        </span>
        <div className="stepper" role="group" aria-labelledby={`${amountId}-label`}>
          <button aria-label="Cook fewer servings" disabled={cooking <= 1} onClick={() => step(-1)}>
            <Minus size={20} aria-hidden />
          </button>
          <span className="stat-num" aria-live="polite">
            {formatServings(cooking)}
          </span>
          <button aria-label="Cook more servings" onClick={() => step(1)}>
            <Plus size={20} aria-hidden />
          </button>
        </div>
        {!editing && (
          <button className="btn-quiet" onClick={() => setEditing(true)}>
            Edit serving size
          </button>
        )}
      </div>

      {editing && (
        <div className="scale-edit" role="group" aria-label="Edit serving size">
          <span className="scale-label" id={`${amountId}-makes`}>
            This recipe makes
          </span>
          <div className="scale-main">
            <div className="stepper" role="group" aria-labelledby={`${amountId}-makes`}>
              <button aria-label="Fewer servings in the recipe" disabled={servings <= 1} onClick={() => onSetServings(servings - 1)}>
                <Minus size={20} aria-hidden />
              </button>
              <span className="stat-num" aria-live="polite">
                {formatServings(servings)}
              </span>
              <button aria-label="More servings in the recipe" onClick={() => onSetServings(servings + 1)}>
                <Plus size={20} aria-hidden />
              </button>
            </div>
            <span className="scale-label">{servings === 1 ? 'serving' : 'servings'}</span>
          </div>
          <p className="hint">Calories and protein per serving are worked out from this, so a bigger number means smaller servings.</p>
          <button className="btn-primary" onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      )}

      {changed ? (
        <p className="hint" role="status">
          Scaled from the recipe&apos;s {formatServings(servings)}, so every amount is ×{formatServings(factorForServings(cooking, servings))}. In total that is{' '}
          <b>{Math.round(kcalPerServing * cooking).toLocaleString()} kcal</b> and <b>{Math.round(proteinPerServing * cooking)} g protein</b>.{' '}
          <button className="btn-quiet" onClick={() => onTarget(null)}>
            Reset to {formatServings(servings)}
          </button>
        </p>
      ) : null}

      {usable.length > 0 && (
        <details className="scale-more">
          <summary>Or scale to what I have</summary>
          <div className="scale-form">
            {capacity?.kind === 'max' && (
              <p className="hint">
                Your pantry covers about {formatServings(Math.floor(capacity.factor * servings * 2) / 2)} servings, running out of{' '}
                {capacity.limiting.name.toLowerCase()} first.{' '}
                {capacity.factor * servings >= 0.5 && (
                  <button className="btn-quiet" onClick={() => onTarget(Math.floor(capacity.factor * servings * 2) / 2)}>
                    Cook that much
                  </button>
                )}
              </p>
            )}
            {capacity?.kind === 'missing' && (
              <p className="hint">
                Not in your pantry: {capacity.foods.map((f) => f.name.toLowerCase()).join(', ')}. Seasonings and water are assumed to be in the
                cupboard.
              </p>
            )}

            <div className="field">
              <label htmlFor={`${amountId}-food`}>Which ingredient?</label>
              <select
                id={`${amountId}-food`}
                className="input"
                value={picked?.index ?? 0}
                onChange={(e) => {
                  setPickedIndex(Number(e.target.value))
                  setHave('')
                }}
              >
                {usable.map(({ line, index, food }) => (
                  <option key={index} value={index}>
                    {food.name} ({formatAmount(line.qty, line.unit)} in the recipe)
                  </option>
                ))}
              </select>
            </div>

            {picked && (
              <>
                <div className="field">
                  <label htmlFor={`${amountId}-have`}>How much do you have? ({UNIT_WORD[picked.line.unit] ?? picked.line.unit})</label>
                  <input
                    id={`${amountId}-have`}
                    className="input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    value={have}
                    onChange={(e) => setHave(e.target.value)}
                  />
                </div>
                <div className="actions">
                  <button className="btn-primary" disabled={!(haveNumber > 0)} onClick={scaleToHave}>
                    Scale the recipe
                  </button>
                  {inPantry && pickedGrams ? (
                    <button className="btn-outline" onClick={() => onTarget((inPantry.grams / pickedGrams) * servings)}>
                      Use my pantry ({formatAmount(inPantry.grams, 'g')})
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </details>
      )}
    </div>
  )
}
