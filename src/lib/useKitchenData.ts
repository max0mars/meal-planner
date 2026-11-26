import { useMemo } from 'react'
import { useLiveQuery } from '../api/liveQuery'
import { db, withDefaults, type ResolvedSettings } from '../db'
import { tagLevelMap } from './sensitivity'

/** Your settings, with defaults for anything not set yet. Null until loaded. */
export function useSettings(): ResolvedSettings | null {
  // `undefined` means still loading; a missing row is a valid result, so it is stored as null.
  const stored = useLiveQuery(async () => (await db.settings.get(1)) ?? null, [])
  return useMemo(() => (stored === undefined ? null : withDefaults(stored)), [stored])
}

/** Live ingredients, sensitivity levels and settings, shared by the recipe screens. Null until loaded. */
export function useKitchenData() {
  const ingredients = useLiveQuery(() => db.ingredients.toArray(), [])
  const tagRows = useLiveQuery(() => db.tagSensitivities.toArray(), [])
  const settings = useSettings()

  const byId = useMemo(() => new Map((ingredients ?? []).map((i) => [i.id!, i])), [ingredients])
  const levels = useMemo(() => tagLevelMap(tagRows ?? []), [tagRows])

  if (!ingredients || !tagRows || !settings) return null
  return {
    ingredients,
    tagRows,
    byId,
    levels,
    settings,
    combinedCap: settings.combinedLightCapPct,
    defaultLimit: settings.defaultLightThresholdPct,
  }
}
