import { useMemo, useState } from 'react'
import { useLiveQuery } from '../api/liveQuery'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, ScanBarcode } from 'lucide-react'
import { db } from '../db'
import { TAGS, TAG_LABEL } from '../data/tags'
import AddFoodSheet from '../components/AddFoodSheet'
import BarcodeFlow, { type ScannedFood } from '../components/BarcodeFlow'
import LevelSlider from '../components/LevelSlider'
import { effectiveSensitivity, tagLevelMap } from '../lib/sensitivity'
import type { Ingredient, Sensitivity } from '../types'

const WORD: Record<Sensitivity, string> = { safe: 'Safe', light: 'Light', major: 'Major' }

function list(words: string[]) {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

export default function Ingredients() {
  const [query, setQuery] = useState('')
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  /** The add/edit sheet: empty object adds a food, `name` pre-fills it, `food` edits one of yours. Null when closed. */
  const [sheet, setSheet] = useState<{ name?: string; food?: Ingredient; scanned?: ScannedFood } | null>(null)
  const [scanning, setScanning] = useState(false)
  /** A scanned barcode matched a food that is not yours to edit: say so instead of doing nothing. */
  const [scanNote, setScanNote] = useState('')
  const all = useLiveQuery(() => db.ingredients.orderBy('name').toArray(), [])
  const tagRows = useLiveQuery(() => db.tagSensitivities.toArray(), [])
  const levels = useMemo(() => tagLevelMap(tagRows ?? []), [tagRows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (all ?? [])
      .map((i) => ({ i, eff: effectiveSensitivity(i, levels) }))
      .filter(({ eff }) => (onlyFlagged ? eff.level !== 'safe' : true))
      .filter(({ i }) => !q || i.name.toLowerCase().includes(q) || i.aliases.some((a) => a.includes(q)))
  }, [all, levels, query, onlyFlagged])

  if (!all || !tagRows) return <p className="muted">Loading…</p>

  const avoided = TAGS.filter((t) => levels.get(t.id) === 'major').map((t) => t.label.toLowerCase())
  const limited = TAGS.filter((t) => levels.get(t.id) === 'light').map((t) => t.label.toLowerCase())

  const setTag = (tag: string, sensitivity: Sensitivity) =>
    sensitivity === 'safe' ? db.tagSensitivities.delete(tag) : db.tagSensitivities.put({ tag, sensitivity })

  return (
    <section>
      <Link to="/settings" className="back">
        <ArrowLeft size={20} aria-hidden /> Settings
      </Link>
      <header className="page-head">
        <h1>Your sensitivities</h1>
        {avoided.length + limited.length === 0 ? (
          <p className="lede">Nothing flagged yet. Slide a category to Light or Major.</p>
        ) : (
          <div className="summary stack">
            {avoided.length > 0 && <p className="avoid">Avoiding {list(avoided)}.</p>}
            {limited.length > 0 && <p className="limit">Limiting {list(limited)}.</p>}
          </div>
        )}
        <p className="lede">
          Light foods can appear in recipes in small amounts, with a warning. Major foods never appear.
        </p>
      </header>

      <div className="board">
        {TAGS.map((t) => {
          const level = levels.get(t.id) ?? 'safe'
          return (
            <div key={t.id} className={`tile ${level}`}>
              <span className="t-name">{t.label}</span>
              <span className="t-hint">{t.hint}</span>
              <LevelSlider value={level} label={`${t.label} sensitivity`} onChange={(v) => setTag(t.id, v)} />
            </div>
          )
        })}
      </div>

      <div className="block-head">
        <h2>Individual foods</h2>
        <p>Mark a single food. If its categories are stricter, the stricter level applies.</p>
      </div>
      <input
        className="search"
        type="search"
        placeholder={`Search ${all.length} foods`}
        aria-label="Search foods"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="button" className="btn-quiet photo-pick" onClick={() => setScanning(true)}>
        <ScanBarcode size={20} aria-hidden /> Scan a barcode to add a food
      </button>
      {scanNote && (
        <p className="hint" role="status">
          {scanNote}
        </p>
      )}
      <label className="filter">
        <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />
        Show only foods I should limit or avoid
      </label>

      <ul className="rows">
        {shown.map(({ i, eff }) => {
          const why = eff.reasons.length > 0 ? ` because of ${list(eff.reasons.map((r) => TAG_LABEL[r].toLowerCase()))}` : ''
          return (
            <li key={i.id} className={`row ${eff.level}`}>
              <div className="r-name">
                {i.name}
                {i.custom && <span className="mine">Yours</span>}
              </div>
              <div className="r-nums">
                <span>{i.kcalPer100g} kcal</span>
                <span>{i.proteinPer100g} g protein</span>
                <span>per 100 g</span>
              </div>
              {i.tags.length > 0 && (
                <div className="chips">
                  {i.tags.map((t) => (
                    <span key={t} className="chip">
                      {TAG_LABEL[t] ?? t}
                    </span>
                  ))}
                </div>
              )}
              <LevelSlider
                value={i.sensitivity}
                label={`${i.name} sensitivity`}
                onChange={(v) => db.ingredients.update(i.id!, { sensitivity: v })}
              />
              {eff.level !== 'safe' && eff.level !== i.sensitivity && (
                <div className="r-why">
                  {WORD[eff.level]}
                  {why}
                </div>
              )}
              {i.custom && (
                <button className="btn-quiet edit-food" onClick={() => setSheet({ food: i })} aria-label={`Edit ${i.name}`}>
                  Edit
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {shown.length === 0 && (
        <p className="empty">
          No foods match.{' '}
          {query.trim() && (
            <button className="btn-quiet" onClick={() => setSheet({ name: query.trim() })}>
              Add “{query.trim()}” as a new food
            </button>
          )}
        </p>
      )}

      <button className="fab" onClick={() => setSheet({})}>
        <Plus size={24} aria-hidden />
        Add a food
      </button>

      {sheet && (
        <AddFoodSheet
          initialName={sheet.name}
          scanned={sheet.scanned}
          editing={sheet.food}
          onSaved={() => setSheet(null)}
          onDeleted={() => setSheet(null)}
          onClose={() => setSheet(null)}
        />
      )}
      {scanning && (
        <BarcodeFlow
          onClose={() => setScanning(false)}
          onKnown={(food) => {
            setScanning(false)
            if (food.custom) setSheet({ food })
            else setScanNote(`That barcode is ${food.name}, which is already in your list.`)
          }}
          onNew={(scanned) => {
            setScanning(false)
            setScanNote('')
            setSheet({ scanned })
          }}
        />
      )}
    </section>
  )
}
