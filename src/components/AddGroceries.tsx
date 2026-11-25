import { useMemo, useRef, useState } from 'react'
import { Check, ScanBarcode } from 'lucide-react'
import { db } from '../db'
import { defaultExpiry } from '../lib/expiry'
import {
  LOCATION_LABEL,
  defaultLocation,
  defaultUnit,
  formatDate,
  locationsFor,
  searchIngredients,
  todayIso,
} from '../lib/pantry'
import { UNITS } from '../lib/units'
import type { Ingredient, StorageLocation, Unit } from '../types'
import AddFoodSheet from './AddFoodSheet'
import BarcodeFlow, { type ScannedFood } from './BarcodeFlow'

export interface QuickPicks {
  title: string
  items: Ingredient[]
}

export default function AddGroceries({
  ingredients,
  quickPicks,
  onClose,
}: {
  ingredients: Ingredient[]
  quickPicks: QuickPicks
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Ingredient | null>(null)
  const [qty, setQty] = useState('')
  const [unit, setUnit] = useState<Unit>('g')
  const [location, setLocation] = useState<StorageLocation>('fridge')
  const [purchasedOn, setPurchasedOn] = useState(todayIso())
  // null = use the usual date for this food, place and purchase date; a string = the user's own date.
  const [customExpiry, setCustomExpiry] = useState<string | null>(null)
  const [added, setAdded] = useState('')
  /** What was typed when "add as a new food" was tapped, while the sheet is open. */
  const [creating, setCreating] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  /** A scanned product that is not one of your foods yet, waiting for you to check and save it. */
  const [scanned, setScanned] = useState<ScannedFood | null>(null)

  const matches = useMemo(() => searchIngredients(ingredients, query), [ingredients, query])

  const expiryEdited = customExpiry !== null
  const expiresOn = customExpiry ?? (picked && purchasedOn ? defaultExpiry(picked, purchasedOn, location) : '')

  const choose = (ing: Ingredient) => {
    setPicked(ing)
    setQuery('')
    setUnit(defaultUnit(ing))
    setLocation(defaultLocation(ing))
    setCustomExpiry(null)
    setAdded('')
  }

  const qtyNum = Number(qty)
  const ready = picked != null && qtyNum > 0 && expiresOn !== '' && purchasedOn !== ''

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!picked || !ready) return
    await db.pantryItems.add({ ingredientId: picked.id!, qty: qtyNum, unit, purchasedOn, expiresOn, location })
    setAdded(`Added ${picked.name}. Use by ${formatDate(expiresOn)}.`)
    setPicked(null)
    setQty('')
    setCustomExpiry(null)
    searchRef.current?.focus()
  }

  const guideline = picked?.shelfLifeDays[location]

  return (
    <form className="add" onSubmit={submit}>
      <div className="add-head">
        <h2>Add groceries</h2>
        <button type="button" className="btn-quiet" onClick={onClose}>
          Done
        </button>
      </div>

      {added && (
        <p className="added" role="status" key={added}>
          <Check size={20} aria-hidden />
          {added}
        </p>
      )}

      {picked ? (
        <div className="picked">
          <span className="picked-name">{picked.name}</span>
          <button type="button" className="btn-quiet" onClick={() => setPicked(null)}>
            Change
          </button>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="grocery-search">What did you buy?</label>
          <input
            id="grocery-search"
            ref={searchRef}
            className="input"
            type="search"
            autoComplete="off"
            placeholder="Search foods, like chicken or oats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" className="btn-quiet photo-pick" onClick={() => setScanning(true)}>
            <ScanBarcode size={20} aria-hidden /> Scan a barcode
          </button>
          {query.trim() === '' && quickPicks.items.length > 0 && (
            <div className="quick">
              <p className="quick-title">{quickPicks.title}</p>
              <div className="quick-list">
                {quickPicks.items.map((i) => (
                  <button key={i.id} type="button" onClick={() => choose(i)}>
                    {i.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          {query.trim() !== '' && (
            <ul className="suggest">
              {matches.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => choose(m)}>
                    {m.name}
                  </button>
                </li>
              ))}
              {matches.length === 0 && <li className="suggest-none">No match. Try a simpler word.</li>}
              <li>
                <button type="button" className="suggest-add" onClick={() => setCreating(query.trim())}>
                  Not here? Add “{query.trim()}” as a new food
                </button>
              </li>
            </ul>
          )}
        </div>
      )}

      {picked && (
        <>
          <div className="field">
            <label htmlFor="grocery-qty">How much?</label>
            <div className="qty">
              <input
                id="grocery-qty"
                className="input"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
              <select className="input" aria-label="Unit" value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className="field">
            <legend>Where will you keep it?</legend>
            <div className="choices">
              {locationsFor(picked).map((l) => (
                <label key={l} className={location === l ? 'on' : ''}>
                  <input
                    type="radio"
                    name="location"
                    checked={location === l}
                    onChange={() => {
                      setLocation(l)
                      setCustomExpiry(null)
                    }}
                  />
                  {LOCATION_LABEL[l]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="dates">
            <div className="field">
              <label htmlFor="grocery-bought">Bought on</label>
              <input id="grocery-bought" className="input" type="date" value={purchasedOn} onChange={(e) => setPurchasedOn(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="grocery-expires">Use by</label>
              <input
                id="grocery-expires"
                className="input"
                type="date"
                value={expiresOn}
                onChange={(e) => setCustomExpiry(e.target.value || null)}
              />
            </div>
          </div>
          {guideline != null && !expiryEdited && (
            <p className="hint">
              Usually lasts {guideline} {guideline === 1 ? 'day' : 'days'} in the {location}.
            </p>
          )}
          {expiryEdited && (
            <button type="button" className="btn-quiet" onClick={() => setCustomExpiry(null)}>
              Use the usual date
            </button>
          )}
        </>
      )}

      <button className="btn-primary" type="submit" disabled={!ready}>
        Add to pantry
      </button>
      {!ready && <p className="hint">{picked ? 'Enter how much you bought.' : 'Pick a food to add it.'}</p>}

      {scanning && (
        <BarcodeFlow
          onClose={() => setScanning(false)}
          onKnown={(food) => {
            setScanning(false)
            choose(food)
          }}
          onNew={(s) => {
            setScanning(false)
            setScanned(s)
          }}
        />
      )}

      {scanned && (
        <AddFoodSheet
          scanned={scanned}
          onSaved={(food) => {
            choose(food)
            // the pack size on the label is usually what you bought
            const pack = scanned.product?.package
            if (pack) {
              setQty(String(pack.qty))
              setUnit(pack.unit)
            }
            setScanned(null)
          }}
          onClose={() => setScanned(null)}
        />
      )}

      {creating !== null && (
        <AddFoodSheet
          initialName={creating}
          onSaved={(food) => {
            choose(food)
            setCreating(null)
          }}
          onClose={() => setCreating(null)}
        />
      )}
    </form>
  )
}
