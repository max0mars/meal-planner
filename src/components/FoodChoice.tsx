import { effectiveSensitivity } from '../lib/sensitivity'
import type { Ingredient, Sensitivity } from '../types'

const AUTO = 'auto'

/**
 * A flexible ingredient you tap to pick the food for: "Meat: Pork sausages ▾". The first choice lets the app pick (the
 * safest food for you, preferring what you have), and says which food that would be. Foods you are sensitive to say so.
 */
export default function FoodChoice({
  label,
  value,
  picked,
  options,
  auto,
  levels,
  onPick,
}: {
  /** What the line is called, such as "Meat". */
  label: string
  /** The food in use now. */
  value: Ingredient
  /** True when you picked `value` yourself. */
  picked: boolean
  options: Ingredient[]
  /** What the app would pick for you. */
  auto?: Ingredient
  levels: Map<string, Sensitivity>
  /** The food you picked, or undefined to let the app pick. */
  onPick: (foodId: number | undefined) => void
}) {
  const note = (food: Ingredient) => {
    const level = effectiveSensitivity(food, levels).level
    return level === 'safe' ? '' : ` (${level === 'major' ? 'Major' : 'Light'} sensitivity)`
  }
  return (
    <label className="food-choice">
      <span className="food-choice-label">{label}:</span>
      <select
        className="time-select"
        aria-label={label}
        value={picked ? String(value.id) : AUTO}
        onChange={(e) => onPick(e.target.value === AUTO ? undefined : Number(e.target.value))}
      >
        <option value={AUTO}>{auto ? `Choose for me (${auto.name})` : 'Choose for me'}</option>
        {options.map((food) => (
          <option key={food.id} value={food.id}>
            {food.name}
            {note(food)}
          </option>
        ))}
      </select>
    </label>
  )
}
