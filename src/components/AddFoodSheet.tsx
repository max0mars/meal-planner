import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { ScanBarcode, X } from 'lucide-react'
import { CATEGORIES } from '../data/categories'
import { TAGS } from '../data/tags'
import { db } from '../db'
import {
  buildIngredient,
  checkDraft,
  draftFromIngredient,
  emptyDraft,
  per100g,
  shelfForCategory,
  suggestTags,
  type FoodDraft,
} from '../lib/customFood'
import { LOCATION_LABEL, LOCATION_ORDER } from '../lib/pantry'
import type { Ingredient } from '../types'
import BarcodeFlow, { type ScannedFood } from './BarcodeFlow'

/**
 * A sheet over the current screen for adding a food of your own, or editing one. It sits on top so that
 * whatever you were doing (a half-written recipe, a pantry entry) is still there when it closes.
 */
export default function AddFoodSheet({
  initialName = '',
  scanned,
  editing,
  onSaved,
  onClose,
  onDeleted,
}: {
  initialName?: string
  /** A food read from a barcode: the form starts filled in from it, for you to check. */
  scanned?: ScannedFood
  /** A food you added earlier, to change. Omit to add a new one. */
  editing?: Ingredient
  onSaved: (food: Ingredient) => void
  onClose: () => void
  onDeleted?: () => void
}) {
  const uid = useId()
  const liveFoods = useLiveQuery(() => db.ingredients.toArray(), [])
  const foods = useMemo(() => liveFoods ?? [], [liveFoods])
  const [draft, setDraft] = useState<FoodDraft>(() => (editing ? draftFromIngredient(editing) : (scanned?.draft ?? emptyDraft(initialName))))
  const [tried, setTried] = useState(false)
  const [shelfTouched, setShelfTouched] = useState(!!editing)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notices, setNotices] = useState<string[]>(scanned?.notices ?? [])
  const [scanning, setScanning] = useState(false)
  /** A scan found a food you already have: offer to use it instead of adding a copy. */
  const [alreadyHave, setAlreadyHave] = useState<Ingredient | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // Lock the page behind the sheet, focus the first field, and give focus back when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    nameRef.current?.focus()
    return () => {
      document.body.style.overflow = overflow
      before?.focus?.()
    }
  }, [])

  const usage = useLiveQuery(
    async () =>
      editing?.id == null
        ? null
        : {
            recipes: await db.recipes.filter((r) => r.ingredients.some((l) => l.ingredientId === editing.id || l.anyOf?.includes(editing.id!))).count(),
            pantry: await db.pantryItems.where('ingredientId').equals(editing.id).count(),
          },
    [editing?.id],
  )

  const check = useMemo(() => checkDraft(draft, foods, editing?.id), [draft, foods, editing?.id])
  const suggestions = useMemo(() => suggestTags(draft.name, draft.tags), [draft.name, draft.tags])
  const preview = per100g(draft)
  const set = (changes: Partial<FoodDraft>) => setDraft((d) => ({ ...d, ...changes }))
  const toggleTag = (id: string) => set({ tags: draft.tags.includes(id) ? draft.tags.filter((t) => t !== id) : [...draft.tags, id] })
  const err = (field: keyof typeof check.errors) => (tried ? check.errors[field] : undefined)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    // React events bubble out of a portal into the form that opened it: don't let this submit save that form too.
    e.stopPropagation()
    setTried(true)
    if (Object.keys(check.errors).length > 0) return
    const built = buildIngredient(draft)
    if (editing?.id != null) {
      // keep the sensitivity you already set on it
      const { sensitivity: _keep, ...fields } = built
      await db.ingredients.update(editing.id, { ...fields, gramsPerPiece: built.gramsPerPiece, gramsPerMl: built.gramsPerMl })
      onSaved({ ...editing, ...fields, gramsPerPiece: built.gramsPerPiece, gramsPerMl: built.gramsPerMl })
    } else {
      const id = (await db.ingredients.add(built)) as number
      onSaved({ ...built, id })
    }
  }

  const remove = async () => {
    if (editing?.id == null) return
    await db.ingredients.delete(editing.id)
    onDeleted?.()
  }

  const inUse = !!usage && (usage.recipes > 0 || usage.pantry > 0)
  const field = (id: string) => `${uid}-${id}`

  return createPortal(
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby={field('title')}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <form className="sheet-body" onSubmit={save} noValidate>
        <div className="sheet-head">
          <h2 id={field('title')}>{editing ? 'Edit food' : 'Add a food'}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={24} aria-hidden />
          </button>
        </div>

        {!editing && (
          <button type="button" className="btn-quiet photo-pick" onClick={() => setScanning(true)}>
            <ScanBarcode size={20} aria-hidden /> {draft.barcode ? 'Scan a different barcode' : 'Fill in from a barcode'}
          </button>
        )}
        {draft.barcode && <p className="hint">Barcode {draft.barcode}. A later scan will find this food.</p>}
        {alreadyHave && (
          <div className="scan-notices" role="status">
            <p>
              You already have “{alreadyHave.name}” with this barcode.
            </p>
            <button type="button" className="btn-quiet" onClick={() => onSaved(alreadyHave)}>
              Use {alreadyHave.name}
            </button>
          </div>
        )}
        {notices.length > 0 && (
          <div className="scan-notices" role="status">
            {notices.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        )}

        <div className="field">
          <label htmlFor={field('name')}>Name</label>
          <input
            id={field('name')}
            ref={nameRef}
            className="input"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            aria-invalid={!!err('name')}
            aria-describedby={err('name') ? field('name-err') : undefined}
          />
          {err('name') && (
            <p className="field-error" id={field('name-err')}>
              {err('name')}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor={field('category')}>What kind of food is it?</label>
          <select
            id={field('category')}
            className="input"
            value={draft.category}
            onChange={(e) => set({ category: e.target.value, ...(shelfTouched ? {} : { shelf: shelfForCategory(e.target.value) }) })}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="field">
          <legend>The label gives nutrition…</legend>
          <div className="choices">
            {(
              [
                ['per100g', 'Per 100 g'],
                ['perServing', 'Per serving'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={draft.basis === value ? 'on' : ''}>
                <input type="radio" name={field('basis')} checked={draft.basis === value} onChange={() => set({ basis: value })} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>

        {draft.basis === 'perServing' && (
          <div className="field">
            <label htmlFor={field('serving')}>Serving size (g)</label>
            <input
              id={field('serving')}
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={draft.servingGrams}
              onChange={(e) => set({ servingGrams: e.target.value })}
              aria-invalid={!!err('servingGrams')}
            />
            {err('servingGrams') && <p className="field-error">{err('servingGrams')}</p>}
          </div>
        )}

        <div className="dates">
          <div className="field">
            <label htmlFor={field('kcal')}>Calories (kcal)</label>
            <input
              id={field('kcal')}
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={draft.kcal}
              onChange={(e) => set({ kcal: e.target.value })}
              aria-invalid={!!err('kcal')}
            />
          </div>
          <div className="field">
            <label htmlFor={field('protein')}>Protein (g)</label>
            <input
              id={field('protein')}
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={draft.protein}
              onChange={(e) => set({ protein: e.target.value })}
              aria-invalid={!!err('protein')}
            />
          </div>
        </div>
        {err('kcal') && <p className="field-error">{err('kcal')}</p>}
        {err('protein') && <p className="field-error">{err('protein')}</p>}
        {preview && !check.errors.kcal && !check.errors.protein && (
          <p className="hint" aria-live="polite">
            Works out to {Math.round(preview.kcal)} kcal and {Math.round(preview.protein * 10) / 10} g protein per 100 g.
          </p>
        )}

        <fieldset className="field">
          <legend>Allergens and triggers</legend>
          <p className="hint">Tick everything this food contains or is made from.</p>
          {suggestions.length > 0 && (
            <div className="suggested" role="status">
              <span>From the name, you may want:</span>
              {suggestions.map((id) => (
                <button key={id} type="button" className="btn-outline" onClick={() => toggleTag(id)}>
                  Add {TAGS.find((t) => t.id === id)!.label}
                </button>
              ))}
            </div>
          )}
          <div className="filters" role="group" aria-label="Allergens and triggers">
            {TAGS.map((t) => (
              <button key={t.id} type="button" aria-pressed={draft.tags.includes(t.id)} className={draft.tags.includes(t.id) ? 'on' : ''} onClick={() => toggleTag(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        </fieldset>

        <details className="scale-more">
          <summary>More details: other names, weights, how long it keeps</summary>
          <div className="scale-form">
            <div className="field">
              <label htmlFor={field('aliases')}>Other names, separated by commas</label>
              <input
                id={field('aliases')}
                className="input"
                value={draft.aliases}
                onChange={(e) => set({ aliases: e.target.value })}
                placeholder="black onion seeds, kalonji"
              />
              <p className="hint">Recipes pasted with any of these names will find this food.</p>
            </div>
            <div className="dates">
              <div className="field">
                <label htmlFor={field('piece')}>One piece weighs (g)</label>
                <input
                  id={field('piece')}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={draft.gramsPerPiece}
                  onChange={(e) => set({ gramsPerPiece: e.target.value })}
                  aria-invalid={!!err('gramsPerPiece')}
                />
              </div>
              <div className="field">
                <label htmlFor={field('cup')}>One cup weighs (g)</label>
                <input
                  id={field('cup')}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={draft.gramsPerCup}
                  onChange={(e) => set({ gramsPerCup: e.target.value })}
                  aria-invalid={!!err('gramsPerCup')}
                />
              </div>
            </div>
            <p className="hint">Optional. They let recipes use pieces, cups and spoons of this food.</p>

            <fieldset className="field">
              <legend>How many days does it keep?</legend>
              <p className="hint">Leave a place blank if you would not keep it there.</p>
              <div className="shelf-grid">
                {LOCATION_ORDER.map((l) => (
                  <div className="field" key={l}>
                    <label htmlFor={field(`shelf-${l}`)}>{LOCATION_LABEL[l]}</label>
                    <input
                      id={field(`shelf-${l}`)}
                      className="input"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      value={draft.shelf[l]}
                      onChange={(e) => {
                        setShelfTouched(true)
                        set({ shelf: { ...draft.shelf, [l]: e.target.value } })
                      }}
                    />
                  </div>
                ))}
              </div>
              {err('shelf') && <p className="field-error">{err('shelf')}</p>}
            </fieldset>
          </div>
        </details>

        {check.warnings.length > 0 && (
          <ul className="warnings" aria-live="polite">
            {check.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {editing && (
          <div className="delete-food">
            {inUse ? (
              <p className="hint">
                Used in {usage!.recipes} {usage!.recipes === 1 ? 'recipe' : 'recipes'}
                {usage!.pantry > 0 ? ` and ${usage!.pantry} pantry ${usage!.pantry === 1 ? 'item' : 'items'}` : ''}. Remove it from those before deleting it.
              </p>
            ) : confirmDelete ? (
              <div className="actions">
                <button type="button" className="btn-remove" onClick={remove}>
                  Yes, delete this food
                </button>
                <button type="button" className="btn-quiet" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </div>
            ) : (
              <button type="button" className="btn-quiet" onClick={() => setConfirmDelete(true)}>
                Delete this food
              </button>
            )}
          </div>
        )}

        <div className="sheet-actions">
          <button className="btn-primary" type="submit">
            {editing ? 'Save changes' : 'Save food'}
          </button>
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
        {tried && Object.keys(check.errors).length > 0 && (
          <p className="field-error" role="alert">
            Fix the highlighted fields to save this food.
          </p>
        )}
      </form>
      {scanning && (
        <BarcodeFlow
          onClose={() => setScanning(false)}
          onKnown={(food) => {
            setScanning(false)
            setAlreadyHave(food)
          }}
          onNew={(s) => {
            setScanning(false)
            setAlreadyHave(null)
            setDraft(s.draft)
            setNotices(s.notices)
            setShelfTouched(false)
          }}
        />
      )}
    </div>,
    document.body,
  )
}
