import { useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, X } from 'lucide-react'
import { recipeNutrition } from '../lib/nutrition'
import { defaultUnit } from '../lib/pantry'
import { UNITS } from '../lib/units'
import type { Ingredient, RecipeIngredient, Unit } from '../types'
import IngredientPicker from './IngredientPicker'
import { useSheetFocus } from './useSheetFocus'

interface Line {
  food: Ingredient
  qty: string
  unit: Unit
  /** Borrowed from someone else's food: not taken from your pantry. */
  borrowed: boolean
}

/** A sensible first amount for a food: one of it when it comes in pieces (an egg, an apple), else a cup or 100 g. */
function startAmount(food: Ingredient): Pick<Line, 'qty' | 'unit'> {
  if (food.gramsPerPiece) return { qty: '1', unit: 'piece' }
  if (defaultUnit(food) === 'ml') return { qty: '250', unit: 'ml' }
  return { qty: '100', unit: 'g' }
}

/**
 * A meal of plain foods, with no recipe: "3 eggs, a slice of toast and an apple". Pick each food and how much; the
 * calories and protein add up as you go. Opened with `initial`, it edits a meal's foods: add some, take some away, or
 * change how much. With `eatenOption`, you can say you have already eaten it (which takes it out of the pantry, as Made
 * it does).
 */
export default function FoodsSheet({
  title,
  ingredients,
  initial,
  eatenOption = false,
  eatenByDefault = false,
  onSave,
  onClose,
}: {
  title: string
  ingredients: Ingredient[]
  /** The meal's foods, to change them. */
  initial?: { foods: RecipeIngredient[]; borrowed?: number[] }
  /** Offer "I've eaten it". */
  eatenOption?: boolean
  eatenByDefault?: boolean
  /** The foods, whether you have eaten it, and the ids of the foods you borrowed. */
  onSave: (foods: RecipeIngredient[], eaten: boolean, borrowed: number[]) => void | Promise<void>
  onClose: () => void
}) {
  const uid = useId()
  useSheetFocus()
  const byId = useMemo(() => new Map(ingredients.map((i) => [i.id!, i])), [ingredients])
  const [lines, setLines] = useState<Line[]>(() =>
    (initial?.foods ?? []).flatMap((f) => {
      const food = byId.get(f.ingredientId)
      return food ? [{ food, qty: String(f.qty), unit: f.unit, borrowed: initial?.borrowed?.includes(food.id!) ?? false }] : []
    }),
  )
  const [eaten, setEaten] = useState(eatenByDefault)
  const [saving, setSaving] = useState(false)

  const valid = lines.filter((l) => Number(l.qty) > 0)
  const foods: RecipeIngredient[] = valid.map((l) => ({ ingredientId: l.food.id!, qty: Number(l.qty), unit: l.unit }))
  const totals = recipeNutrition({ servings: 1, ingredients: foods }, byId)
  const change = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, n) => (n === i ? { ...l, ...patch } : l)))

  const save = async () => {
    if (saving || foods.length === 0 || valid.length !== lines.length) return
    setSaving(true)
    await onSave(foods, eatenOption && eaten, [...new Set(valid.filter((l) => l.borrowed).map((l) => l.food.id!))])
  }

  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2 id={`${uid}-title`}>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={24} aria-hidden />
          </button>
        </div>
        <p className="hint">
          Just some foods, no recipe. Add each thing and how much of it. Any food will do, not only what is in your pantry; tick Borrowed for food
          that is not yours.
        </p>

        {lines.length > 0 && (
          <ul className="foods-list">
            {lines.map((l, i) => (
              <li key={`${l.food.id}-${i}`} className="foods-line">
                <span className="foods-name">{l.food.name}</span>
                <div className="line-amount">
                  <input
                    className="input"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="any"
                    aria-label={`Amount of ${l.food.name}`}
                    value={l.qty}
                    onChange={(e) => change(i, { qty: e.target.value })}
                  />
                  <select className="input" aria-label={`Unit for ${l.food.name}`} value={l.unit} onChange={(e) => change(i, { unit: e.target.value as Unit })}>
                    {UNITS.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                  <button type="button" className="icon-btn" aria-label={`Remove ${l.food.name}`} onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))}>
                    <Trash2 size={20} aria-hidden />
                  </button>
                </div>
                <label className="check">
                  <input type="checkbox" checked={l.borrowed} aria-label={`Borrowed ${l.food.name}`} onChange={(e) => change(i, { borrowed: e.target.checked })} />{' '}
                  Borrowed (not from my pantry)
                </label>
              </li>
            ))}
          </ul>
        )}

        <IngredientPicker
          key={lines.length}
          label={lines.length === 0 ? 'What did you have?' : 'Add another food'}
          ingredients={ingredients}
          value={null}
          onPick={(food) => setLines((ls) => [...ls, { food, ...startAmount(food), borrowed: false }])}
          onClear={() => {}}
        />

        {foods.length > 0 && (
          <p className="foods-totals" aria-live="polite">
            <b>{Math.round(totals.totalKcal)}</b> kcal · <b>{Math.round(totals.totalProtein)}</b> g protein
            {totals.uncounted.length > 0 && <span className="hint"> (not counting {totals.uncounted.map((f) => f.name).join(', ')}: enter it in grams)</span>}
          </p>
        )}

        {eatenOption && (
          <label className="check">
            <input type="checkbox" checked={eaten} onChange={(e) => setEaten(e.target.checked)} /> I&apos;ve eaten it (takes it out of the pantry)
          </label>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn-primary" disabled={saving || foods.length === 0 || valid.length !== lines.length} onClick={save}>
            {initial ? 'Save changes' : 'Save meal'}
          </button>
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
