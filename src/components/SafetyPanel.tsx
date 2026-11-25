import { describeReason, pct, type RecipeSafety } from '../lib/recipeSafety'

/** Explains in plain language why a recipe is fine, carries a warning, or is not recommended. */
export default function SafetyPanel({ safety }: { safety: RecipeSafety }) {
  if (safety.status === 'ok') return null
  const excluded = safety.status === 'excluded'
  return (
    <div className={`safety ${safety.status}`} role={excluded ? 'alert' : 'note'}>
      <h2>{excluded ? 'Not recommended for you' : 'Contains foods you limit'}</h2>
      <ul>
        {safety.reasons
          .filter((r) => !excluded || r.kind !== 'light-ok' || safety.combined != null)
          .map((r) => (
            <li key={r.ingredient.id}>{describeReason(r)}</li>
          ))}
        {safety.combined && (
          <li>
            Your Light foods add up to {pct(safety.combined.share)} of the recipe, over your {pct(safety.combined.cap)} combined limit
          </li>
        )}
      </ul>
    </div>
  )
}
