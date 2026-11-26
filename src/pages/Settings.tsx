import { useId, useState } from 'react'
import { useLiveQuery } from '../api/liveQuery'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { db, withDefaults, type ResolvedSettings } from '../db'
import BackupPanel from '../components/BackupPanel'
import { CUISINE_REGIONS, cuisineRegion, normalizeRegions } from '../lib/cuisine'
import TimeField from '../components/TimeField'
import { useSettings } from '../lib/useKitchenData'
import type { MealSlot, Settings as SettingsType } from '../types'

const SLOTS: { id: MealSlot; label: string }[] = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snack' },
]

/**
 * A number that saves as you type, as long as it is in range. What you are typing stays as typed, so a half-finished
 * number is never replaced under you. Percentages are shown as whole numbers (15) and saved as shares (0.15).
 */
function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  unit,
  percent = false,
  onCommit,
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  unit: string
  percent?: boolean
  onCommit: (v: number) => void
}) {
  const id = useId()
  const shown = percent ? Math.round(value * 100) : value
  const [text, setText] = useState(String(shown))
  const n = Number(text)
  const valid = text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="with-unit">
        <input
          id={id}
          className="input"
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          value={text}
          aria-invalid={!valid}
          onChange={(e) => {
            setText(e.target.value)
            const v = Number(e.target.value)
            if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= min && v <= max) onCommit(percent ? v / 100 : v)
          }}
        />
        <span className="unit">{unit}</span>
      </div>
      {!valid && (
        <p className="field-error">
          Enter a number from {min} to {max}.
        </p>
      )}
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

export default function Settings() {
  const settings = useSettings()
  const recipes = useLiveQuery(() => db.recipes.toArray(), [])
  if (!settings) return <p className="muted">Loading…</p>

  // how many of your recipes are in each region
  const regionCounts = new Map<string, number>(CUISINE_REGIONS.map((r) => [r.name, 0]))
  for (const r of recipes ?? []) {
    const region = cuisineRegion(r.cuisine)
    if (region) regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1)
  }

  // Each change is applied to the latest saved settings inside a transaction, so two quick taps run one after the other
  // and both count, instead of the second overwriting the first with a stale copy.
  const update = (change: Partial<SettingsType> | ((latest: ResolvedSettings) => Partial<SettingsType>)) =>
    db.transaction('rw', db.settings, async () => {
      const latest = withDefaults(await db.settings.get(1))
      const next = { ...latest, ...(typeof change === 'function' ? change(latest) : change) }
      // the older on/off flag follows the list of cuisines, so both always agree
      await db.settings.put({ ...next, preferFamiliar: (next.preferredCuisines?.length ?? 0) > 0 })
    })
  const slots = settings.planSlots ?? []
  const toggleCuisine = (name: string) =>
    update((s) => ({ preferredCuisines: normalizeRegions(s.preferredCuisines.includes(name) ? s.preferredCuisines.filter((x) => x !== name) : [...s.preferredCuisines, name]) }))
  const toggleSlot = (slot: MealSlot) =>
    update((s) => {
      const current = s.planSlots ?? []
      const next = current.includes(slot) ? current.filter((x) => x !== slot) : [...current, slot]
      // at least one meal always stays
      return next.length > 0 ? { planSlots: SLOTS.map((x) => x.id).filter((id) => next.includes(id)) } : {}
    })

  return (
    <section>
      <header className="page-head">
        <h1>Settings</h1>
      </header>

      <Link to="/ingredients" className="setting-link">
        <span>
          <strong>Foods and sensitivities</strong>
          <span className="hint">Mark what to limit or avoid, and add your own foods.</span>
        </span>
        <ChevronRight size={24} aria-hidden />
      </Link>

      <div className="block-head">
        <h2>Daily targets</h2>
        <p>Your plan is checked against these, one day at a time.</p>
      </div>
      <div className="dates">
        <NumberSetting label="Calories" value={settings.kcalTarget} min={1000} max={6000} unit="kcal" onCommit={(v) => update({ kcalTarget: v })} />
        <NumberSetting label="Protein" value={settings.proteinTarget} min={20} max={400} unit="g" onCommit={(v) => update({ proteinTarget: v })} />
      </div>

      <div className="block-head">
        <h2>Meals to plan</h2>
        <p>The planner suggests the meals you tick here. Pick at least one.</p>
      </div>
      <div className="filters" role="group" aria-label="Meals to plan">
        {SLOTS.map((s) => (
          <button key={s.id} aria-pressed={slots.includes(s.id)} className={slots.includes(s.id) ? 'on' : ''} onClick={() => toggleSlot(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="block-head">
        <h2>Light-sensitivity limits</h2>
        <p>
          A recipe is hidden when a Light food is more than this share of its weight, or when all its Light foods together are more than the
          combined limit.
        </p>
      </div>
      <div className="dates">
        <NumberSetting
          label="One food at most"
          value={settings.defaultLightThresholdPct}
          min={1}
          max={50}
          unit="%"
          percent
          onCommit={(v) => update({ defaultLightThresholdPct: v })}
        />
        <NumberSetting
          label="All together at most"
          value={settings.combinedLightCapPct}
          min={5}
          max={80}
          unit="%"
          percent
          onCommit={(v) => update({ combinedLightCapPct: v })}
        />
      </div>

      <div className="block-head">
        <h2>Time format</h2>
        <p>How times look across the app. Times you have already set are not changed.</p>
      </div>
      <div className="filters" role="group" aria-label="Time format">
        <button aria-pressed={settings.timeFormat === '12h'} className={settings.timeFormat === '12h' ? 'on' : ''} onClick={() => update({ timeFormat: '12h' })}>
          12-hour (6:30 PM)
        </button>
        <button aria-pressed={settings.timeFormat === '24h'} className={settings.timeFormat === '24h' ? 'on' : ''} onClick={() => update({ timeFormat: '24h' })}>
          24-hour (18:30)
        </button>
      </div>

      <div className="block-head">
        <h2>Meal times</h2>
        <p>When you usually eat. Used for cooking start times and your calendar. You can change a single meal on the plan.</p>
      </div>
      <div className="time-stack">
        {SLOTS.filter((s) => slots.includes(s.id)).map((s) => (
          <div className="field" key={s.id}>
            <span className="legend">{s.label}</span>
            <TimeField label={s.label} value={settings.mealTimes[s.id]} format={settings.timeFormat} onChange={(time) => update((cur) => ({ mealTimes: { ...cur.mealTimes, [s.id]: time } }))} />
          </div>
        ))}
      </div>
      <NumberSetting
        label="“Little time” means"
        hint="A meal marked Quick, or a day marked little time, only gets recipes that take this long or less."
        value={settings.quickMinutes}
        min={10}
        max={90}
        unit="min"
        onCommit={(v) => update({ quickMinutes: v })}
      />

      <div className="block-head">
        <h2>Everyday meals</h2>
        <p>The planner leans towards the kinds of food you pick. Choose as many as you like, or none to treat every cuisine equally. Recipes you write yourself always count.</p>
      </div>
      <div className="filters" role="group" aria-label="Cuisines to prefer">
        {CUISINE_REGIONS.map((region) => {
          const on = settings.preferredCuisines.includes(region.name)
          return (
            <button key={region.name} aria-pressed={on} className={on ? 'on' : ''} onClick={() => toggleCuisine(region.name)}>
              {region.name}
              <span className="count">{regionCounts.get(region.name) ?? 0}</span>
            </button>
          )
        })}
      </div>
      {settings.preferredCuisines.length > 0 && (
        <button className="btn-quiet" onClick={() => update({ preferredCuisines: [] })}>
          Clear all
        </button>
      )}

      <div className="block-head">
        <h2>Leftovers</h2>
      </div>
      <NumberSetting
        label="Days cooked food keeps"
        hint="Meals of the same recipe planned within this many days count as one cook, with the rest eaten as leftovers."
        value={settings.leftoverShelfLifeDays}
        min={1}
        max={10}
        unit="days"
        onCommit={(v) => update({ leftoverShelfLifeDays: v })}
      />

      <BackupPanel />
    </section>
  )
}
