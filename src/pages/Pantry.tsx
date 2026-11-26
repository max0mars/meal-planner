import { useMemo, useState } from 'react'
import { useLiveQuery } from '../api/liveQuery'
import { Plus, ReceiptText, X } from 'lucide-react'
import { db } from '../db'
import AddGroceries, { type QuickPicks } from '../components/AddGroceries'
import ReceiptFlow from '../components/ReceiptFlow'
import { TAG_LABEL } from '../data/tags'
import {
  LOCATION_LABEL,
  LOCATION_ORDER,
  SOON_DAYS,
  daysLeft,
  amountLabel,
  expiryLabel,
  expiryStatus,
  formatDate,
  groupByUrgency,
  locationsFor,
  timeLeftFraction,
  todayIso,
} from '../lib/pantry'
import { effectiveSensitivity, tagLevelMap } from '../lib/sensitivity'
import { useShoppingFoodIds } from '../lib/useShoppingFoodIds'
import type { Ingredient, PantryItem, StorageLocation } from '../types'

type Filter = 'all' | StorageLocation

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

export default function Pantry() {
  const [adding, setAdding] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [openId, setOpenId] = useState<number | null>(null)
  const [scanning, setScanning] = useState(false)
  const [receiptNote, setReceiptNote] = useState('')
  const [removed, setRemoved] = useState<{ item: PantryItem; name: string } | null>(null)
  const onShoppingList = useShoppingFoodIds()

  const items = useLiveQuery(() => db.pantryItems.toArray(), [])
  const ingredients = useLiveQuery(() => db.ingredients.toArray(), [])
  const tagRows = useLiveQuery(() => db.tagSensitivities.toArray(), [])
  const today = todayIso()

  const byId = useMemo(() => new Map((ingredients ?? []).map((i) => [i.id!, i])), [ingredients])
  const levels = useMemo(() => tagLevelMap(tagRows ?? []), [tagRows])
  const visible = useMemo(
    () => (items ?? []).filter((p) => byId.has(p.ingredientId) && (filter === 'all' || p.location === filter)),
    [items, byId, filter],
  )
  const groups = useMemo(() => groupByUrgency(visible, today), [visible, today])

  // Tappable starting points for the add form: what you bought recently, else common staples.
  // Foods that are Major for you are never suggested.
  const quickPicks = useMemo<QuickPicks>(() => {
    const allowed = (i: Ingredient) => effectiveSensitivity(i, levels).level !== 'major'
    const recent: Ingredient[] = []
    const seen = new Set<number>()
    const newestFirst = [...(items ?? [])].sort((a, b) => b.purchasedOn.localeCompare(a.purchasedOn) || (b.id ?? 0) - (a.id ?? 0))
    for (const p of newestFirst) {
      const ing = byId.get(p.ingredientId)
      if (ing && !seen.has(ing.id!) && allowed(ing)) {
        seen.add(ing.id!)
        recent.push(ing)
      }
      if (recent.length === 6) break
    }
    if (recent.length > 0) return { title: 'Bought recently', items: recent }
    const staples = ['Eggs', 'Chicken breast', 'White rice', 'Rolled oats', 'Banana', 'Potato', 'Carrot', 'Salmon']
    const common = staples.map((n) => (ingredients ?? []).find((i) => i.name === n)).filter((i): i is Ingredient => !!i && allowed(i))
    return { title: 'Common buys', items: common.slice(0, 6) }
  }, [items, ingredients, byId, levels])

  if (!items || !ingredients || !tagRows) return <p className="muted">Loading…</p>

  const total = items.length
  const pastDate = items.filter((p) => daysLeft(p.expiresOn, today) < 0).length
  const soon = items.filter((p) => {
    const d = daysLeft(p.expiresOn, today)
    return d >= 0 && d <= SOON_DAYS
  }).length

  return (
    <section>
      <header className="page-head">
        <h1>Pantry</h1>
        {total === 0 ? (
          <p className="lede">Nothing here yet. Add what you buy and each item gets a use-by date automatically.</p>
        ) : (
          <p className="summary">
            {plural(total, 'item', 'items')}.
            {pastDate > 0 && <span className="avoid"> {pastDate} past date.</span>}
            {soon > 0 && <span className="limit"> {soon} to use in the next {SOON_DAYS} days.</span>}
          </p>
        )}
      </header>

      {receiptNote && (
        <p className="added" role="status" key={receiptNote}>
          {receiptNote}
        </p>
      )}

      {removed && (
        <p className="added undo-bar" role="status" key={removed.item.id}>
          <span>Removed {removed.name}.</span>
          <button
            className="btn-quiet"
            onClick={async () => {
              await db.pantryItems.put(removed.item)
              setRemoved(null)
            }}
          >
            Undo
          </button>
        </p>
      )}

      {adding && <AddGroceries ingredients={ingredients} quickPicks={quickPicks} onClose={() => setAdding(false)} />}

      {total > 0 && (
        <div className="filters" role="group" aria-label="Filter by storage place">
          {(['all', ...LOCATION_ORDER] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : LOCATION_LABEL[f]}
            </button>
          ))}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.key} className="group">
          <h2 className={`group-title ${g.key}`}>
            {g.title} <span className="count">{g.items.length}</span>
          </h2>
          <ul className="pantry-list">
            {g.items.map((p) => (
              <PantryRow
                key={p.id}
                item={p}
                ingredient={byId.get(p.ingredientId)!}
                today={today}
                open={openId === p.id}
                onToggle={() => setOpenId(openId === p.id ? null : p.id!)}
                onRemove={() => {
                  setRemoved({ item: p, name: byId.get(p.ingredientId)!.name })
                  db.pantryItems.delete(p.id!)
                }}
                level={effectiveSensitivity(byId.get(p.ingredientId)!, levels)}
              />
            ))}
          </ul>
        </div>
      ))}

      {total > 0 && groups.length === 0 && <p className="empty">Nothing in the {filter} right now.</p>}

      {!adding && (
        <button className="btn-outline scan-receipt" onClick={() => setScanning(true)}>
          <ReceiptText size={20} aria-hidden /> Scan a receipt
        </button>
      )}

      {scanning && (
        <ReceiptFlow
          foods={ingredients}
          onList={onShoppingList}
          onClose={() => setScanning(false)}
          onDone={(n) => {
            setScanning(false)
            setReceiptNote(`Added ${n} ${n === 1 ? 'item' : 'items'} from your receipt.`)
          }}
        />
      )}

      {!adding && (
        <button className="fab" onClick={() => setAdding(true)}>
          <Plus size={24} aria-hidden />
          Add groceries
        </button>
      )}
    </section>
  )
}

function PantryRow({
  item,
  ingredient,
  today,
  open,
  onToggle,
  onRemove,
  level,
}: {
  item: PantryItem
  ingredient: Ingredient
  today: string
  open: boolean
  onToggle: () => void
  onRemove: () => void
  level: ReturnType<typeof effectiveSensitivity>
}) {
  const days = daysLeft(item.expiresOn, today)
  const status = expiryStatus(days)
  const { value, caption } = expiryLabel(days)
  const amount = amountLabel(item.qty, item.unit)
  const fraction = timeLeftFraction(item.expiresOn, today)
  const update = (changes: Partial<PantryItem>) => db.pantryItems.update(item.id!, changes)
  const panelId = `pantry-edit-${item.id}`

  return (
    <li className={`pantry-row ${status}`}>
      <button className="pantry-main" onClick={onToggle} aria-expanded={open} aria-controls={panelId}>
        <span className="days amount">
          <span className="days-num">{amount.value}</span>
          <span className="days-cap">{amount.caption}</span>
        </span>
        <span className="pantry-body">
          <span className="r-name">{ingredient.name}</span>
          <span className="r-nums">
            <span className="time-left">
              {value} {caption}
            </span>
            <span>{LOCATION_LABEL[item.location]}</span>
            <span>Use by {formatDate(item.expiresOn)}</span>
          </span>
          {level.level !== 'safe' && (
            <span className={`pantry-flag ${level.level}`}>
              {level.level === 'major' ? 'Major' : 'Light'} sensitivity
              {level.reasons.length > 0 && `: ${level.reasons.map((r) => TAG_LABEL[r].toLowerCase()).join(', ')}`}
            </span>
          )}
          {/* time left out of 21 days: full with 21 or more days to go, empty on the use-by date */}
          <span className="bar time-bar" aria-hidden title={`${Math.round(fraction * 100)}% of its time left`}>
            <span className="bar-fill" style={{ width: `${Math.round(fraction * 100)}%` }} />
          </span>
        </span>
      </button>
      <button className="pantry-x" aria-label={`Remove ${ingredient.name} from pantry`} onClick={onRemove}>
        <X size={20} aria-hidden />
      </button>

      {open && (
        <div className="pantry-edit" id={panelId}>
          <div className="field">
            <label htmlFor={`qty-${item.id}`}>Amount left ({item.unit})</label>
            <input
              id={`qty-${item.id}`}
              className="input"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              defaultValue={item.qty}
              onChange={(e) => {
                const n = Number(e.target.value)
                if (e.target.value !== '' && n >= 0) update({ qty: n })
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`exp-${item.id}`}>Use by</label>
            <input
              id={`exp-${item.id}`}
              className="input"
              type="date"
              value={item.expiresOn}
              onChange={(e) => e.target.value && update({ expiresOn: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`loc-${item.id}`}>Stored in</label>
            <select
              id={`loc-${item.id}`}
              className="input"
              value={item.location}
              onChange={(e) => update({ location: e.target.value as StorageLocation })}
            >
              {Array.from(new Set([...locationsFor(ingredient), item.location])).map((l) => (
                <option key={l} value={l}>
                  {LOCATION_LABEL[l]}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-remove" onClick={onRemove}>
            Remove from pantry
          </button>
        </div>
      )}
    </li>
  )
}
