// Applies src/lib/seedFixes.ts to src/data/recipes.seed.json. Safe to run again: a fix that is already in is skipped.
// Usage: npx tsx scripts/apply-seed-fixes.ts
// Run it after scripts/build-recipes.ts, which rebuilds the file from the original data and would undo the fixes.
import { readFileSync, writeFileSync } from 'node:fs'
import { SEED_FIXES } from '../src/lib/seedFixes'

const path = 'src/data/recipes.seed.json'
const seed = JSON.parse(readFileSync(path, 'utf8')) as {
  seedId: string
  title: string
  servings: number
  servingsEstimated?: boolean
  ingredients: { name: string; qty: number; unit: string }[]
}[]
const foods = new Set((JSON.parse(readFileSync('src/data/ingredients.seed.json', 'utf8')) as { name: string }[]).map((f) => f.name))

let changed = 0
for (const fix of SEED_FIXES) {
  const r = seed.find((s) => s.seedId === fix.seedId)
  if (!r) throw new Error(`No recipe ${fix.seedId} (${fix.title})`)
  for (const l of [...(fix.now ?? []), ...(fix.add ?? [])]) if (!foods.has(l.name)) throw new Error(`${fix.title}: unknown food ${l.name}`)
  const before = JSON.stringify(r)
  if (fix.was && fix.now) {
    const at = fix.was.map((w) => r.ingredients.findIndex((l) => l.name === w.name && l.qty === w.qty && l.unit === w.unit))
    if (!at.some((i) => i < 0)) r.ingredients = r.ingredients.map((l, i) => (at.includes(i) ? { ...fix.now![at.indexOf(i)] } : l))
  }
  for (const a of fix.add ?? []) if (!r.ingredients.some((l) => l.name === a.name)) r.ingredients.push({ ...a })
  if (fix.drop) r.ingredients = r.ingredients.filter((l) => !fix.drop!.includes(l.name))
  if (fix.servings && r.servings === fix.servings.was) {
    r.servings = fix.servings.now
    r.servingsEstimated = fix.servings.estimated
  }
  if (JSON.stringify(r) !== before) changed++
}
writeFileSync(path, JSON.stringify(seed, null, 1))
console.log(`Changed ${changed} of ${SEED_FIXES.length} recipes.`)
