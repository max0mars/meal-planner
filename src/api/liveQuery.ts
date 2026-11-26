// Replaces dexie-react-hooks. Any change to the data tells every live query to run again.
import { useEffect, useState, type DependencyList } from 'react'

type Listener = () => void
const listeners = new Set<Listener>()

/** Called after every write, once the server has confirmed it. */
export function notifyChange(): void {
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Runs `querier` now and again after every change, returning its latest result (undefined until the first one arrives).
 * Same signature as Dexie's useLiveQuery, so the screens didn't need to change.
 */
export function useLiveQuery<T>(querier: () => T | Promise<T>, deps: DependencyList = [], defaultResult?: T): T | undefined {
  const [value, setValue] = useState<T | undefined>(defaultResult)
  useEffect(() => {
    let active = true
    const run = async () => {
      try {
        const result = await querier()
        if (active) setValue(() => result)
      } catch (e) {
        console.error(e)
      }
    }
    void run()
    const unsubscribe = subscribe(run)
    return () => {
      active = false
      unsubscribe()
    }
    // The deps are the caller's, the same as with Dexie's hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return value
}
