import { useId, useState } from 'react'
import type { TimeFormat } from '../lib/times'

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1)
const pad = (n: number) => String(n).padStart(2, '0')

/** "18:30" as the three parts you pick from: 6, 30, PM. */
function parts(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number)
  const hour = Number.isFinite(h) ? h : 0
  return { hour12: hour % 12 === 0 ? 12 : hour % 12, minute: Number.isFinite(m) ? m : 0, pm: hour >= 12 }
}

/** The three parts back to "18:30". 12 AM is midnight and 12 PM is noon. */
function join(hour12: number, minute: number, pm: boolean): string {
  return `${pad((hour12 % 12) + (pm ? 12 : 0))}:${pad(minute)}`
}

/**
 * A time of day as hour 1 to 12, minute and AM or PM, or as hour 0 to 23 and minute with the 24-hour setting. The value stays
 * "HH:MM" (24-hour) either way, so everything stored and calculated is unchanged. The browser's own time field follows the
 * device's 12 or 24 hour setting and cannot be forced.
 * Minutes go in 5s, plus the minute already set if it is not one of them.
 */
export default function TimeField({ label, value, format = '12h', onChange }: { label: string; value: string; format?: TimeFormat; onChange: (hhmm: string) => void }) {
  const uid = useId()
  // Show what was just picked straight away, even if the value is saved a moment later. A different value from outside wins.
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(null)
  const current = draft && draft.base === value ? draft.text : value
  const { hour12, minute, pm } = parts(current)
  const hour24 = Number(current.split(':')[0]) || 0
  const minutes = Array.from({ length: 12 }, (_, i) => i * 5)
  if (!minutes.includes(minute)) minutes.push(minute)
  minutes.sort((a, b) => a - b)

  const pick = (next: string) => {
    setDraft({ base: value, text: next })
    onChange(next)
  }

  return (
    <div className={`time-field${format === '24h' ? ' h24' : ''}`} role="group" aria-label={label}>
      {format === '24h' ? (
        <select id={`${uid}-h`} className="input" aria-label="Hour" value={hour24} onChange={(e) => pick(`${pad(Number(e.target.value))}:${pad(minute)}`)}>
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {pad(h)}
            </option>
          ))}
        </select>
      ) : (
        <select id={`${uid}-h`} className="input" aria-label="Hour" value={hour12} onChange={(e) => pick(join(Number(e.target.value), minute, pm))}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      )}
      <select id={`${uid}-m`} className="input" aria-label="Minute" value={minute} onChange={(e) => pick(`${pad(hour24)}:${pad(Number(e.target.value))}`)}>
        {minutes.map((m) => (
          <option key={m} value={m}>
            {pad(m)}
          </option>
        ))}
      </select>
      {format === '12h' && (
        <select id={`${uid}-p`} className="input" aria-label="AM or PM" value={pm ? 'PM' : 'AM'} onChange={(e) => pick(join(hour12, minute, e.target.value === 'PM'))}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      )}
    </div>
  )
}
