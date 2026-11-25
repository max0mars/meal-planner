import { useId, useRef, type PointerEvent } from 'react'
import type { Sensitivity } from '../types'

const ORDER: Sensitivity[] = ['safe', 'light', 'major']
const WORD: Record<Sensitivity, string> = { safe: 'Safe', light: 'Light', major: 'Major' }

/**
 * Three-position slider for safe / light / major. Tap a position, drag the thumb,
 * or use the arrow keys. Built on native radio inputs so it is a real radio group
 * for keyboards and screen readers.
 */
export default function LevelSlider({
  value,
  label,
  onChange,
}: {
  value: Sensitivity
  label: string
  onChange: (v: Sensitivity) => void
}) {
  const name = useId()
  const track = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const levelAt = (clientX: number): Sensitivity => {
    const r = track.current!.getBoundingClientRect()
    const i = Math.floor(((clientX - r.left) / r.width) * ORDER.length)
    return ORDER[Math.min(ORDER.length - 1, Math.max(0, i))]
  }

  const down = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    const v = levelAt(e.clientX)
    if (v !== value) onChange(v)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const v = levelAt(e.clientX)
    if (v !== value) onChange(v)
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  return (
    <div
      ref={track}
      className="slider"
      data-level={value}
      role="radiogroup"
      aria-label={label}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <span className="slider-thumb" style={{ transform: `translateX(${ORDER.indexOf(value) * 100}%)` }} aria-hidden />
      {ORDER.map((v) => (
        <label key={v} className={value === v ? 'on' : ''}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} />
          {WORD[v]}
        </label>
      ))}
    </div>
  )
}
