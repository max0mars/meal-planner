import { useId } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Minus, Plus, X } from 'lucide-react'
import { db } from '../db'
import { backTo } from '../lib/backTo'
import { formatDate } from '../lib/pantry'
import { CONSTRAINT_LABEL, SLOT_LABEL } from '../lib/plan'
import { changeServings, removeMeal, setTimes } from '../lib/planEdit'
import { formatServings } from '../lib/scaling'
import { cookStart, eatTime } from '../lib/times'
import type { useRecipeRows } from '../lib/useRecipeRows'
import type { MealPlanEntry, MealSlot, Settings } from '../types'
import RatingButtons from './RatingButtons'
import TimeField from './TimeField'
import { useSheetFocus } from './useSheetFocus'

type Kitchen = NonNullable<ReturnType<typeof useRecipeRows>>

/**
 * One planned meal: its recipe, the servings, and when you eat and start cooking. Every change is saved as you make it.
 */
export default function SlotSheet({
  date,
  slot,
  entry,
  kitchen,
  settings,
  leftover,
  onClose,
}: {
  date: string
  slot: MealSlot
  entry?: MealPlanEntry
  kitchen: Kitchen
  settings: Settings & Required<Pick<Settings, 'mealTimes' | 'quickMinutes'>>
  /** True when this meal is eaten from an earlier cook. */
  leftover: boolean
  onClose: () => void
}) {
  const uid = useId()
  useSheetFocus()
  const row = entry?.recipeId != null ? kitchen.recipeById.get(entry.recipeId) : undefined
  const eat = entry ? eatTime(entry, settings.mealTimes) : settings.mealTimes[slot]
  const needsCooking = !!row && !leftover && entry?.constraint !== 'leftovers'
  const cook = entry?.cookAt ?? (row ? cookStart(eat, row.recipe.estMinutes) : undefined)

  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="sheet-body">
        <div className="sheet-head">
          <h2 id={`${uid}-title`}>
            {SLOT_LABEL[slot]}, {formatDate(date)}
          </h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={24} aria-hidden />
          </button>
        </div>

        {row && (
          <div className="slot-current">
            <Link to={`/recipes/${row.recipe.id}`} state={backTo('/plan', 'Plan')} className="meal-title" onClick={onClose}>
              {row.recipe.title}
            </Link>
            {row.recipe.description && <p className="r-desc">{row.recipe.description}</p>}
            <span className="r-nums">
              <span>{Math.round(row.nutrition.kcalPerServing * entry!.servingsPlanned)} kcal</span>
              <span>{Math.round(row.nutrition.proteinPerServing * entry!.servingsPlanned)} g protein</span>
              <span>{row.recipe.estMinutes} min</span>
              {entry!.constraint && <span className="leftover-tag">{CONSTRAINT_LABEL[entry!.constraint]}</span>}
              {leftover && !entry!.constraint && <span className="leftover-tag">Leftovers</span>}
            </span>
            <Link to={`/recipes/${row.recipe.id}`} state={backTo('/plan', 'Plan')} className="btn-outline view-recipe" onClick={onClose}>
              View recipe
            </Link>
            <div className="meal-actions">
              <div className="stepper" role="group" aria-label={`Servings of ${row.recipe.title}`}>
                <button type="button" aria-label={`Fewer servings of ${row.recipe.title}`} disabled={entry!.servingsPlanned <= 0.5} onClick={() => changeServings(entry!.id!, -0.5)}>
                  <Minus size={20} aria-hidden />
                </button>
                <span className="stepper-value">
                  {formatServings(entry!.servingsPlanned)} {entry!.servingsPlanned === 1 ? 'serving' : 'servings'}
                </span>
                <button type="button" aria-label={`More servings of ${row.recipe.title}`} onClick={() => changeServings(entry!.id!, 0.5)}>
                  <Plus size={20} aria-hidden />
                </button>
              </div>
              {entry!.servingsPlanned !== (row.recipe.servingsPerMeal || 1) && (
                <button
                  type="button"
                  className="btn-quiet"
                  aria-label={`Make ${formatServings(entry!.servingsPlanned)} servings my usual portion of ${row.recipe.title}`}
                  onClick={() => db.recipes.update(row.recipe.id, { servingsPerMeal: entry!.servingsPlanned })}
                >
                  Make {formatServings(entry!.servingsPlanned)} my usual
                </button>
              )}
            </div>
            <RatingButtons recipeId={row.recipe.id} rating={row.recipe.rating} />
          </div>
        )}

        {entry && (
          <div className="field">
            <span className="legend">Times</span>
            <div className="time-stack">
              <div className="field">
                <span className="legend">Eat at</span>
                <TimeField label="Eat at" value={eat} format={settings.timeFormat} onChange={(v) => setTimes(entry.id!, { eatAt: v })} />
              </div>
              {needsCooking && cook && (
                <div className="field">
                  <span className="legend">Start cooking at</span>
                  <TimeField label="Start cooking at" value={cook} format={settings.timeFormat} onChange={(v) => setTimes(entry.id!, { cookAt: v })} />
                </div>
              )}
            </div>
            {(entry.eatAt || entry.cookAt) && (
              <button type="button" className="btn-quiet" onClick={() => setTimes(entry.id!, { eatAt: undefined, cookAt: undefined })}>
                Use the usual times
              </button>
            )}
            {row && !needsCooking && <p className="hint">Leftovers need no cooking, so there is no cooking time.</p>}
          </div>
        )}

        <div className="sheet-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Done
          </button>
          {entry && (
            <button
              type="button"
              className="btn-remove"
              onClick={async () => {
                await removeMeal(entry.id!)
                onClose()
              }}
            >
              Clear this meal
            </button>
          )}
        </div>
      </div>

    </div>,
    document.body,
  )
}
