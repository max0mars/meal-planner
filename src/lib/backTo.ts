/**
 * Where you came from, kept with a link so the next screen can take you back there. A recipe opened from the plan goes back
 * to the plan, not to the list of recipes.
 */
export interface BackTo {
  /** The route to return to, such as "/plan". */
  from: string
  /** What to call it on the back button, such as "Plan". */
  label: string
}

/** The state to put on a link: `<Link to="/recipes/3" state={backTo('/plan', 'Plan')}>`. */
export const backTo = (from: string, label: string): BackTo => ({ from, label })

/** Reads the state of the current route, ignoring anything that is not a place to go back to. */
export function readBackTo(state: unknown): BackTo | null {
  const s = state as Partial<BackTo> | null | undefined
  return s && typeof s.from === 'string' && s.from.startsWith('/') && typeof s.label === 'string' && s.label ? { from: s.from, label: s.label } : null
}
