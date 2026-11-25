import type { Ingredient, Sensitivity, TagSensitivity } from '../types'

const RANK: Record<Sensitivity, number> = { safe: 0, light: 1, major: 2 }

export function strictest(a: Sensitivity, b: Sensitivity): Sensitivity {
  return RANK[a] >= RANK[b] ? a : b
}

export function tagLevelMap(rows: TagSensitivity[]): Map<string, Sensitivity> {
  return new Map(rows.map((r) => [r.tag, r.sensitivity]))
}

export interface EffectiveSensitivity {
  level: Sensitivity
  /** Tags that raised the level above 'safe' (so the UI can say why). */
  reasons: string[]
  /** True when the ingredient's own label is what set the level. */
  fromIngredient: boolean
}

/**
 * An ingredient's effective sensitivity is the strictest of its own label and
 * the labels of all its tags. E.g. gluten = major makes bread, pasta and soy
 * sauce major, even though each is individually labelled safe.
 */
export function effectiveSensitivity(
  ingredient: Pick<Ingredient, 'sensitivity' | 'tags'>,
  tagLevels: Map<string, Sensitivity>,
): EffectiveSensitivity {
  let level = ingredient.sensitivity
  for (const tag of ingredient.tags) level = strictest(level, tagLevels.get(tag) ?? 'safe')
  const reasons = ingredient.tags.filter((t) => (tagLevels.get(t) ?? 'safe') !== 'safe' && RANK[tagLevels.get(t)!] === RANK[level])
  return { level, reasons, fromIngredient: ingredient.sensitivity !== 'safe' && RANK[ingredient.sensitivity] === RANK[level] }
}
