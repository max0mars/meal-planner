import { useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { db } from '../db'
import { defaultExpiry } from '../lib/expiry'
import { LOCATION_LABEL, defaultLocation, defaultUnit, locationsFor, searchIngredients, todayIso } from '../lib/pantry'
import type { ParsedReceipt } from '../lib/receipt'
import { UNITS, toGrams } from '../lib/units'
import type { Ingredient, StorageLocation, Unit } from '../types'
import { useSheetFocus } from './useSheetFocus'

interface Row {
  key: number
  raw: string
  price?: number
  food: Ingredient | null
  guess: boolean
  include: boolean
  qty: string
  unit: Unit
  location: StorageLocation
  /** Your own use-by date; null means the usual one for this food and place. */
  expiresOn: string | null
  editing: boolean
}

/** The amount a line gets when a food is chosen: what the receipt said if it can be weighed, otherwise blank for you to fill in. */
function amountFor(food: Ingredient, amount: { qty: number; unit: Unit } | undefined): { qty: string; unit: Unit } {
  if (amount && toGrams(amount.qty, amount.unit, food) != null) return { qty: String(amount.qty), unit: amount.unit }
  return { qty: '', unit: defaultUnit(food) }
}

function buildRows(parsed: ParsedReceipt): Row[] {
  return parsed.lines.map((l, key) => {
    const food = l.match
    const amount = food ? amountFor(food, l.amount) : { qty: l.amount ? String(l.amount.qty) : '', unit: l.amount?.unit ?? ('g' as Unit) }
    return {
      key,
      raw: l.raw,
      price: l.price,
      food,
      guess: l.guess,
      include: l.isFood && !!food,
      ...amount,
      location: food ? defaultLocation(food) : 'pantry',
      expiresOn: null,
      editing: false,
    }
  })
}

/**
 * Check what was read from the receipt before anything is added. Reading a printed receipt is never perfect: you can
 * change the food, amount, place and use-by date of every line, untick what you do not want, and nothing reaches the
 * pantry until you confirm.
 */
export default function ReceiptReview({
  parsed,
  foods,
  onList,
  onDone,
  onClose,
}: {
  parsed: ParsedReceipt
  foods: Ingredient[]
  /** Foods on your shopping list, so those lines can say so. */
  onList: Set<number>
  onDone: (added: number) => void
  onClose: () => void
}) {
  const uid = useId()
  useSheetFocus()
  const [rows, setRows] = useState<Row[]>(() => buildRows(parsed))
  const [purchasedOn, setPurchasedOn] = useState(parsed.date ?? todayIso())
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const change = (key: number, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const chooseFood = (row: Row, food: Ingredient) => {
    const original = parsed.lines[row.key].amount
    const amount = row.qty && Number(row.qty) > 0 && toGrams(Number(row.qty), row.unit, food) != null ? { qty: row.qty, unit: row.unit } : amountFor(food, original)
    change(row.key, { food, guess: false, include: true, editing: false, location: defaultLocation(food), expiresOn: null, ...amount })
    setSearch('')
  }

  const included = rows.filter((r) => r.include)
  const problems = included.filter((r) => !r.food || !(Number(r.qty) > 0))
  const matches = useMemo(() => (search.trim() ? searchIngredients(foods, search, 6) : []), [foods, search])

  const add = async () => {
    if (problems.length > 0 || included.length === 0 || saving) return
    setSaving(true)
    await db.pantryItems.bulkAdd(
      included.map((r) => ({
        ingredientId: r.food!.id!,
        qty: Number(r.qty),
        unit: r.unit,
        purchasedOn,
        expiresOn: r.expiresOn ?? defaultExpiry(r.food!, purchasedOn, r.location),
        location: r.location,
      })),
    )
    onDone(included.length)
  }

  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form
        className="sheet-body"
        onSubmit={(e) => {
          e.preventDefault()
          e.stopPropagation()
          add()
        }}
      >
        <div className="sheet-head">
          <h2 id={`${uid}-title`}>Check your receipt</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={24} aria-hidden />
          </button>
        </div>
        <p className="hint">
          Reading a receipt is not perfect. Check each line, fix anything that is wrong, and untick what you do not want. Nothing is added until you tap
          the button at the bottom.
        </p>

        {rows.length === 0 && (
          <p className="empty" role="status">
            No items could be read. Try again with the receipt flat, in good light, and the whole width in the photo.
          </p>
        )}

        <div className="field">
          <label htmlFor={`${uid}-date`}>Bought on</label>
          <input id={`${uid}-date`} className="input" type="date" value={purchasedOn} max={todayIso()} onChange={(e) => setPurchasedOn(e.target.value)} />
          {parsed.date && <p className="hint">Read from the receipt. Change it if it is wrong.</p>}
        </div>

        <ul className="receipt-list">
          {rows.map((r) => {
            const places = r.food ? locationsFor(r.food) : (['fridge', 'freezer', 'pantry'] as StorageLocation[])
            const expiry = r.food ? (r.expiresOn ?? defaultExpiry(r.food, purchasedOn, r.location)) : ''
            return (
              <li key={r.key} className={`receipt-row${r.include ? '' : ' off'}`}>
                <label className="receipt-include">
                  <input type="checkbox" checked={r.include} onChange={(e) => change(r.key, { include: e.target.checked })} aria-label={`Add ${r.raw}`} />
                  <span className="receipt-raw">{r.raw}</span>
                </label>

                <div className="receipt-food">
                  {r.food ? (
                    <>
                      <strong>{r.food.name}</strong>
                      {r.guess && <span className="receipt-note">Best guess, please check</span>}
                      {onList.has(r.food.id!) && <span className="receipt-note on-list">On your shopping list</span>}
                    </>
                  ) : (
                    <span className="receipt-note">No food found</span>
                  )}
                  <button type="button" className="btn-quiet" onClick={() => change(r.key, { editing: !r.editing })} aria-label={`${r.food ? 'Change' : 'Pick'} the food for ${r.raw}`}>
                    {r.food ? 'Change' : 'Pick a food'}
                  </button>
                </div>

                {r.editing && (
                  <div className="receipt-search">
                    <input
                      className="input"
                      type="search"
                      autoComplete="off"
                      placeholder="Search foods"
                      aria-label={`Search a food for ${r.raw}`}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <ul className="suggest">
                      {matches.map((m) => (
                        <li key={m.id}>
                          <button type="button" onClick={() => chooseFood(r, m)}>
                            {m.name}
                          </button>
                        </li>
                      ))}
                      {search.trim() && matches.length === 0 && <li className="suggest-none">No match. Try a simpler word.</li>}
                    </ul>
                  </div>
                )}

                {r.include && r.food && (
                  <div className="receipt-details">
                    <div className="field">
                      <label htmlFor={`${uid}-q${r.key}`}>How much?</label>
                      <div className="qty">
                        <input
                          id={`${uid}-q${r.key}`}
                          className="input"
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="any"
                          value={r.qty}
                          aria-label={`Amount of ${r.food.name}`}
                          aria-invalid={!(Number(r.qty) > 0)}
                          onChange={(e) => change(r.key, { qty: e.target.value })}
                        />
                        <select className="input" aria-label={`Unit for ${r.food.name}`} value={r.unit} onChange={(e) => change(r.key, { unit: e.target.value as Unit })}>
                          {UNITS.map((u) => (
                            <option key={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                      {!(Number(r.qty) > 0) && <p className="field-error">Enter how much you bought.</p>}
                    </div>
                    <div className="field">
                      <label htmlFor={`${uid}-l${r.key}`}>Keep it in</label>
                      <select
                        id={`${uid}-l${r.key}`}
                        className="input"
                        value={r.location}
                        onChange={(e) => change(r.key, { location: e.target.value as StorageLocation, expiresOn: null })}
                      >
                        {places.map((l) => (
                          <option key={l} value={l}>
                            {LOCATION_LABEL[l]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`${uid}-e${r.key}`}>Use by</label>
                      <input id={`${uid}-e${r.key}`} className="input" type="date" value={expiry} onChange={(e) => change(r.key, { expiresOn: e.target.value || null })} />
                    </div>
                    {r.price != null && <p className="hint">Paid {r.price.toFixed(2)}</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <div className="sheet-actions">
          <button className="btn-primary" type="submit" disabled={included.length === 0 || problems.length > 0 || saving}>
            Add {included.length} {included.length === 1 ? 'item' : 'items'} to pantry
          </button>
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
        {problems.length > 0 && (
          <p className="hint" role="status">
            {problems.length === 1 ? '1 ticked line needs a food and an amount.' : `${problems.length} ticked lines need a food and an amount.`}
          </p>
        )}
      </form>
    </div>,
    document.body,
  )
}
