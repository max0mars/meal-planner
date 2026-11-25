import { formatTime, fromMinutes, toMinutes, type TimeFormat } from '../lib/times'

/** Every half hour of the day, as "HH:MM". */
const HALF_HOURS = Array.from({ length: 48 }, (_, i) => fromMinutes(i * 30))

/**
 * A time you tap to change, picked from a list in 30 minute steps. It looks like plain text until you tap it. A time that
 * is not on the half hour (set elsewhere in 5 minute steps) stays in the list so it still shows.
 */
export default function TimeSelect({ label, value, format, className = '', onChange }: { label: string; value: string; format?: TimeFormat; className?: string; onChange: (hhmm: string) => void }) {
  const options = HALF_HOURS.includes(value) ? HALF_HOURS : [...HALF_HOURS, value].sort((a, b) => toMinutes(a) - toMinutes(b))
  return (
    <select className={`time-select ${className}`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((t) => (
        <option key={t} value={t}>
          {formatTime(t, format)}
        </option>
      ))}
    </select>
  )
}
