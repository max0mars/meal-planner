import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from '../api/liveQuery'
import { Check, ChevronDown } from 'lucide-react'
import { db } from '../db'
import { formatDate, todayIso } from '../lib/pantry'
import { cookSessions } from '../lib/plan'
import { aisleLabel, assignToTrips, boughtPantryItem, buildShoppingList, dueCounts, formatBuy, neededWhen, type ShopItem } from '../lib/shopping'
import { formatTime, slotOrder } from '../lib/times'
import { tripPosition } from '../lib/trips'
import { useRecipeRows } from '../lib/useRecipeRows'

function list(words: string[]) {
  return words.length <= 1 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** A group of things to buy (an aisle or a trip) under a bold header that folds the group away. */
function ShopGroup({
  title,
  count,
  tone,
  collapsed,
  onToggle,
  label,
  children,
}: {
  title: string
  count: number
  tone?: 'late'
  collapsed: boolean
  onToggle: () => void
  label?: string
  children: ReactNode
}) {
  const bodyId = useId()
  return (
    <div className="group shop-group" aria-label={label}>
      <h2 className="shop-head-wrap">
        <button type="button" className={`shop-head${tone ? ` ${tone}` : ''}`} aria-expanded={!collapsed} aria-controls={bodyId} onClick={onToggle}>
          <span className="shop-head-title">{title}</span>
          <span className="shop-head-count">{count}</span>
          <ChevronDown size={20} className="shop-head-chevron" aria-hidden />
        </button>
      </h2>
      <div id={bodyId} hidden={collapsed}>
        {children}
      </div>
    </div>
  )
}

export default function Shopping() {
  const kitchen = useRecipeRows()
  const entries = useLiveQuery(() => db.mealPlan.toArray(), [])
  const pantry = useLiveQuery(() => db.pantryItems.toArray(), [])
  const trips = useLiveQuery(() => db.trips.toArray(), [])
  const today = todayIso()
  const settings = kitchen?.data.settings
  // groups the shopper has folded away (by name)
  const [folded, setFolded] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setFolded((cur) => {
      const next = new Set(cur)
      if (!next.delete(key)) next.add(key)
      return next
    })

  const result = useMemo(() => {
    if (!kitchen || !entries || !pantry || !settings || !trips) return null
    const upcoming = entries.filter((e) => e.date >= today)
    const sessions = cookSessions(upcoming, settings.leftoverShelfLifeDays)
    const recipes = new Map(kitchen.rows.map((r) => [r.recipe.id, r.recipe]))
    const shopping = buildShoppingList(sessions, recipes, kitchen.data.byId, pantry.filter((p) => p.expiresOn >= today))
    return {
      shopping,
      byTrip: assignToTrips(shopping.toBuy, trips, today, slotOrder(settings.mealTimes)),
      meals: upcoming.filter((e) => e.status === 'planned').length,
    }
  }, [kitchen, entries, pantry, settings, trips, today])

  if (!result || !settings) return <p className="muted">Loading…</p>
  const { shopping, byTrip, meals } = result

  const bought = (item: ShopItem) => db.pantryItems.add(boughtPantryItem(item.food, item.buyGrams, today))
  const boughtAll = () => db.pantryItems.bulkAdd(shopping.toBuy.map((i) => boughtPantryItem(i.food, i.buyGrams, today)))

  const shopRow = (item: ShopItem) => {
    const when = neededWhen(item.needBy, today)
    return (
      <li key={item.food.id} className={`shop-row${when.urgent ? ` urgent ${when.text}` : ''}`}>
        <div className="shop-main">
          <span className="shop-line">
            <span className="r-name">{item.food.name}</span>
            <span className="shop-buy">{formatBuy(item.food, item.buyGrams, item.allPieces)}</span>
          </span>
          {(item.haveGrams > 0 || item.unknownStock) && (
            <span className="r-nums">
              {item.haveGrams > 0 && <span>You have {formatBuy(item.food, item.haveGrams, item.allPieces)}</span>}
              {item.unknownStock && <span>Some of your stock has no weight, so you may need less.</span>}
            </span>
          )}
        </div>
        <span className="shop-when">{when.label}</span>
        <button className="btn-outline bought" onClick={() => bought(item)} aria-label={`Bought ${item.food.name}`} title="Bought">
          <Check size={20} aria-hidden />
        </button>
      </li>
    )
  }
  const planSlots = settings.planSlots ?? ['lunch', 'dinner']
  const boughtMany = (items: ShopItem[]) => db.pantryItems.bulkAdd(items.map((i) => boughtPantryItem(i.food, i.buyGrams, today)))

  const due = dueCounts(shopping.toBuy, today)
  const things = (n: number) => `${n} ${n === 1 ? 'ingredient' : 'ingredients'}`
  const aisles = [...new Set(shopping.toBuy.map((i) => i.food.category))]

  return (
    <section>
      <header className="page-head">
        <h1>Shopping</h1>
        {shopping.toBuy.length > 0 ? (
          <p className="summary">
            {shopping.toBuy.length} {shopping.toBuy.length === 1 ? 'item' : 'items'} to buy for {meals} planned {meals === 1 ? 'meal' : 'meals'}.
          </p>
        ) : (
          <p className="lede">
            {meals === 0
              ? 'Nothing to buy yet. Plan some meals and what you need shows up here.'
              : 'You have everything for the meals you have planned.'}
          </p>
        )}
        {meals === 0 && (
          <Link to="/plan" className="source-link">
            Plan some meals
          </Link>
        )}
      </header>

      {(due.today > 0 || due.tomorrow > 0) && (
        <div className="shop-due" role="status">
          {due.today > 0 && (
            <p>
              <b>{things(due.today)}</b> needed today
            </p>
          )}
          {due.tomorrow > 0 && (
            <p>
              <b>{things(due.tomorrow)}</b> needed tomorrow
            </p>
          )}
        </div>
      )}

      {byTrip &&
        byTrip.beforeFirstTrip.length > 0 && (
          <ShopGroup title="No grocery trip in time" count={byTrip.beforeFirstTrip.length} tone="late" collapsed={folded.has('first')} onToggle={() => toggle('first')}>
            <ul className="pantry-list">{byTrip.beforeFirstTrip.map((item) => shopRow(item))}</ul>
          </ShopGroup>
        )}

      {byTrip &&
        byTrip.groups.map(({ trip, items }) => (
          <ShopGroup
            key={trip.id}
            title={`${formatDate(trip.date)}, ${formatTime(trip.time, settings.timeFormat)}`}
            count={items.length}
            collapsed={folded.has(`trip-${trip.id}`)}
            onToggle={() => toggle(`trip-${trip.id}`)}
            label={`Trip on ${formatDate(trip.date)}`}
          >
            <p className="hint">
              {tripPosition(trip.after, planSlots, slotOrder(settings.mealTimes))}
              {trip.note ? `. ${trip.note}` : ''}
            </p>
            {items.length === 0 ? (
              <p className="hint">Nothing needed on this trip.</p>
            ) : (
              <>
                {items.length > 1 && (
                  <button className="btn-outline" onClick={() => boughtMany(items)}>
                    <Check size={20} aria-hidden /> Bought everything on this trip
                  </button>
                )}
                <ul className="pantry-list">{items.map((item) => shopRow(item))}</ul>
              </>
            )}
          </ShopGroup>
        ))}

      {!byTrip && shopping.toBuy.length > 1 && (
        <div className="actions">
          <button className="btn-outline" onClick={boughtAll}>
            <Check size={20} aria-hidden /> I bought everything
          </button>
        </div>
      )}

      {!byTrip && aisles.map((category) => {
        const items = shopping.toBuy.filter((i) => i.food.category === category)
        return (
          <ShopGroup key={category} title={aisleLabel(category)} count={items.length} collapsed={folded.has(`aisle-${category}`)} onToggle={() => toggle(`aisle-${category}`)}>
            <ul className="pantry-list">
              {items.map((item) => {
                return shopRow(item)
              })}
            </ul>
          </ShopGroup>
        )
      })}

      {shopping.have.length > 0 && (
        <details className="scale-more">
          <summary>
            Already covered by your pantry ({shopping.have.length})
          </summary>
          <ul className="pantry-list">
            {shopping.have.map((item) => (
              <li key={item.food.id} className="shop-row">
                <div className="shop-main">
                  <span className="r-name">{item.food.name}</span>
                  <span className="r-nums">
                    <span>Need {formatBuy(item.food, item.needGrams, item.allPieces)}</span>
                    <span>You have {formatBuy(item.food, item.haveGrams, item.allPieces)}</span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {shopping.cupboard.length > 0 && (
        <div className="block-head">
          <h2>Check your cupboard</h2>
          <p>
            The plan uses {list(shopping.cupboard.map((f) => f.name.toLowerCase()))}. Seasonings and water are not counted, so make sure you have
            them.
          </p>
        </div>
      )}

      {shopping.unweighed.length > 0 && (
        <p className="hint">
          Couldn&apos;t work out an amount of {list(shopping.unweighed.map((f) => f.name.toLowerCase()))}, so {shopping.unweighed.length === 1 ? 'it is' : 'they are'} not
          listed. Enter {shopping.unweighed.length === 1 ? 'its amount' : 'their amounts'} in grams in the recipe.
        </p>
      )}
    </section>
  )
}
