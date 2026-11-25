import { TAG_LABEL } from '../data/tags'
import type { Ingredient, Recipe, Sensitivity } from '../types'
import { lineWeights } from './nutrition'
import { effectiveSensitivity } from './sensitivity'

export type SafetyKind = 'major' | 'light-too-much' | 'light-ok'

export interface SafetyReason {
  ingredient: Ingredient
  level: Exclude<Sensitivity, 'safe'>
  kind: SafetyKind
  /** Share of the recipe's total ingredient weight, 0 to 1. */
  share: number
  /** Allowed share for a Light ingredient (its own threshold). */
  limit: number
  /** Categories that made this ingredient sensitive (e.g. gluten). */
  via: string[]
}

export interface RecipeSafety {
  status: 'excluded' | 'warn' | 'ok'
  reasons: SafetyReason[]
  /** Set when the Light ingredients together exceed the combined cap. */
  combined?: { share: number; cap: number }
}

/**
 * Decides whether a recipe can be offered.
 * - Any Major ingredient excludes it.
 * - A Light ingredient above its own share of the recipe weight excludes it.
 * - Light ingredients that together exceed the combined cap exclude it.
 * - Otherwise Light ingredients give a warning.
 * "Share" is the ingredient's weight divided by the recipe's total ingredient weight.
 */
export function classifyRecipe(
  recipe: Pick<Recipe, 'ingredients'>,
  byId: Map<number, Ingredient>,
  tagLevels: Map<string, Sensitivity>,
  combinedCap: number,
  /** The limit for a Light food that has none of its own, as a share of the recipe's weight. */
  defaultLimit = 0.15,
): RecipeSafety {
  const lines = lineWeights(recipe, byId)
  const totalGrams = lines.reduce((sum, l) => sum + (l.grams ?? 0), 0)

  // The same ingredient on several lines counts together.
  const grams = new Map<number, number>()
  for (const l of lines) grams.set(l.ingredient.id!, (grams.get(l.ingredient.id!) ?? 0) + (l.grams ?? 0))

  const reasons: SafetyReason[] = []
  let lightShare = 0
  for (const [id, g] of grams) {
    const ingredient = byId.get(id)!
    const eff = effectiveSensitivity(ingredient, tagLevels)
    if (eff.level === 'safe') continue
    const share = totalGrams > 0 ? g / totalGrams : 0
    const limit = ingredient.lightThresholdPct ?? defaultLimit
    if (eff.level === 'major') {
      reasons.push({ ingredient, level: 'major', kind: 'major', share, limit, via: eff.reasons })
    } else {
      lightShare += share
      reasons.push({ ingredient, level: 'light', kind: share > limit ? 'light-too-much' : 'light-ok', share, limit, via: eff.reasons })
    }
  }

  const combined = lightShare > combinedCap ? { share: lightShare, cap: combinedCap } : undefined
  const excluded = combined != null || reasons.some((r) => r.kind === 'major' || r.kind === 'light-too-much')
  const status = excluded ? 'excluded' : reasons.length > 0 ? 'warn' : 'ok'
  return { status, reasons, combined }
}

/** "27%", or "<1%" for a trace amount. */
export function pct(share: number): string {
  return share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`
}

/** One plain-language line explaining why an ingredient was flagged. */
export function describeReason(r: SafetyReason): string {
  const via = r.via.length > 0 ? ` (${r.via.map((v) => TAG_LABEL[v]?.toLowerCase() ?? v).join(', ')})` : ''
  if (r.kind === 'major') return `${r.ingredient.name}: Major sensitivity${via}`
  if (r.kind === 'light-too-much') {
    return `${r.ingredient.name}: ${pct(r.share)} of the recipe, over your ${pct(r.limit)} limit for Light foods${via}`
  }
  return `${r.ingredient.name}: Light sensitivity${via}, ${pct(r.share)} of the recipe`
}
