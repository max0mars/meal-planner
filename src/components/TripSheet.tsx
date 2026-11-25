import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { removeTrip, saveTrip } from '../lib/planEdit'
import { formatDate } from '../lib/pantry'
import { defaultTripTime, slotOrder } from '../lib/times'
import { tripPosition } from '../lib/trips'
import type { MealSlot, Settings, Trip } from '../types'
import TimeField from './TimeField'
import { useSheetFocus } from './useSheetFocus'

/** Add, change or remove a grocery trip at one place in a day. */
export default function TripSheet({
  date,
  after,
  trip,
  planSlots,
  mealTimes,
  timeFormat,
  itemCount,
  onClose,
}: {
  date: string
  after: Trip['after']
  /** The trip already there, when changing one. */
  trip?: Trip
  planSlots: MealSlot[]
  mealTimes: NonNullable<Settings['mealTimes']>
  timeFormat?: Settings['timeFormat']
  /** How many things are on the shopping list for this trip. */
  itemCount?: number
  onClose: () => void
}) {
  const uid = useId()
  useSheetFocus()
  const [time, setTime] = useState(trip?.time ?? defaultTripTime(after, planSlots, mealTimes))
  const [note, setNote] = useState(trip?.note ?? '')

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!time) return
    await saveTrip({ date, after, time, note: note.trim() || undefined }, trip?.id)
    onClose()
  }

  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={`${uid}-title`} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <form className="sheet-body" onSubmit={save}>
        <div className="sheet-head">
          <h2 id={`${uid}-title`}>Groceries, {formatDate(date)}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X size={24} aria-hidden />
          </button>
        </div>
        <p className="hint">{tripPosition(after, planSlots, slotOrder(mealTimes)).replace(/^./, (c) => c.toUpperCase())}.</p>

        <div className="field">
          <span className="legend">Go at</span>
          <TimeField label="Go at" value={time} format={timeFormat} onChange={setTime} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-note`}>Note (optional)</label>
          <input id={`${uid}-note`} className="input" value={note} maxLength={80} placeholder="Big shop, or just milk and bread" onChange={(e) => setNote(e.target.value)} />
        </div>

        {trip && (
          <Link to="/shopping" className="source-link" onClick={onClose}>
            {itemCount ? `See the ${itemCount} ${itemCount === 1 ? 'thing' : 'things'} to buy on this trip` : 'Open the shopping list'}
          </Link>
        )}

        <div className="sheet-actions">
          <button className="btn-primary" type="submit">
            {trip ? 'Save trip' : 'Add trip'}
          </button>
          {trip?.id != null && (
            <button
              type="button"
              className="btn-remove"
              onClick={async () => {
                await removeTrip(trip.id!)
                onClose()
              }}
            >
              Remove this trip
            </button>
          )}
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
