/**
 * Best guess at how many servings an imported recipe makes, for sources that do not say.
 * Most recipe sites write mains for 4 (checked against a BBC Good Food recipe: 4 servings, 22 g protein),
 * baking for 8, and breakfasts for 2. The guess is then nudged so a serving is not absurdly big or tiny.
 * It is only a guess: the app marks it as one and lets you correct it.
 */
export function guessServings(category: string | null | undefined, totalKcal: number): number {
  let servings = category === 'Dessert' ? 8 : category === 'Breakfast' ? 2 : 4
  while (totalKcal / servings > 1000 && servings < 12) servings += 2
  while (totalKcal / servings < 120 && servings > 1) servings -= 1
  return servings
}

/** What the first release guessed (total calories / 600). Kept so existing installs can tell a guess from a value you set. */
export function legacyServingsGuess(totalKcal: number): number {
  return Math.min(8, Math.max(1, Math.round(totalKcal / 600)))
}
