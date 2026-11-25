/** The recipe source names a place ("Netherlands", "France", "British"). Show people the name they would use. */
const LABELS: Record<string, string> = {
  Netherlands: 'Dutch', Norway: 'Norwegian', France: 'French', 'United States': 'American', Belgium: 'Belgian', Denmark: 'Danish',
  Albania: 'Albanian', Aruba: 'Aruban', Botswana: 'Botswanan', Brazil: 'Brazilian', 'Costa Rica': 'Costa Rican', Bulgaria: 'Bulgarian',
  Chile: 'Chilean', Colombia: 'Colombian', Afghanistan: 'Afghan', Angola: 'Angolan', Argentina: 'Argentinian', Venezuela: 'Venezuelan',
  Dominica: 'Dominican', 'Cayman Islands': 'Caymanian', Andorra: 'Andorran', Armenia: 'Armenian', India: 'Indian', Laos: 'Laotian',
  Germany: 'German', Italy: 'Italian', Mexico: 'Mexican', Sweden: 'Swedish', Switzerland: 'Swiss', Austria: 'Austrian',
}

export function cuisineLabel(raw: string | null | undefined): string | undefined {
  const name = raw?.trim()
  if (!name || name.toLowerCase() === 'unknown') return undefined
  return LABELS[name] ?? name
}

/**
 * Everyday meals for someone eating a western diet: the British Isles, the rest of western and northern Europe,
 * and North America and Australia. A recipe with no cuisine (one you wrote yourself) counts as familiar.
 */
const FAMILIAR = new Set([
  'British', 'Irish', 'French', 'Italian', 'Spanish', 'Greek', 'Portuguese', 'Dutch', 'Belgian', 'German', 'Polish', 'Danish',
  'Norwegian', 'Swedish', 'Swiss', 'Austrian', 'Andorran', 'American', 'Canadian', 'Australian',
])

/**
 * The broad regions you choose between in Settings. The recipes' own cuisines are far too many to pick from (about 55, many
 * with a recipe or two), so each one belongs to a region. A cuisine not listed here, such as one you type on your own
 * recipe, belongs to no region and is never held back.
 */
export const CUISINE_REGIONS: { name: string; cuisines: string[] }[] = [
  { name: 'American & Australian', cuisines: ['American', 'Canadian', 'Australian'] },
  { name: 'British & Irish', cuisines: ['British', 'Irish'] },
  { name: 'Southern European', cuisines: ['Italian', 'Spanish', 'Portuguese', 'Andorran'] },
  { name: 'Western & Northern European', cuisines: ['French', 'Dutch', 'Belgian', 'German', 'Swiss', 'Austrian', 'Danish', 'Norwegian', 'Swedish'] },
  { name: 'Eastern European', cuisines: ['Polish', 'Bulgarian', 'Albanian', 'Russian', 'Ukrainian', 'Croatian', 'Slovakia', 'Slovak'] },
  { name: 'Mediterranean & Middle Eastern', cuisines: ['Turkish', 'Greek', 'Syrian', 'Saudi Arabian', 'Egyptian', 'Armenian', 'Afghan', 'Lebanese', 'Israeli', 'Iranian'] },
  { name: 'African', cuisines: ['Algerian', 'Botswanan', 'Kenyan', 'Angolan', 'Tunisian', 'Moroccan', 'Nigerian', 'Ethiopian', 'South African'] },
  {
    name: 'Caribbean & Latin American',
    cuisines: ['Jamaican', 'Aruban', 'Caymanian', 'Dominican', 'Barbados', 'Mexican', 'Chilean', 'Venezuelan', 'Costa Rican', 'Brazilian', 'Argentinian', 'Colombian', 'Uruguayan', 'Peruvian'],
  },
  { name: 'Asian', cuisines: ['Filipino', 'Thai', 'Chinese', 'Indian', 'Japanese', 'Vietnamese', 'Cambodia', 'Cambodian', 'Laotian', 'Korean', 'Malaysian', 'Indonesian'] },
]

/** Which region a cuisine belongs to, if it is in one. */
export function cuisineRegion(cuisine: string | null | undefined): string | undefined {
  return CUISINE_REGIONS.find((r) => r.cuisines.includes(cuisine ?? ''))?.name
}

/** The regions chosen by default: the everyday western ones. */
export const DEFAULT_REGIONS: string[] = ['American & Australian', 'British & Irish', 'Southern European', 'Western & Northern European']

/**
 * A saved list of preferences as regions. An older install saved single cuisines ("Italian"), which become their region;
 * anything else is dropped. The result keeps the order of CUISINE_REGIONS.
 */
export function normalizeRegions(saved: string[]): string[] {
  const names = new Set(CUISINE_REGIONS.map((r) => r.name))
  const chosen = new Set(saved.map((s) => (names.has(s) ? s : cuisineRegion(s))).filter((s): s is string => !!s))
  return CUISINE_REGIONS.map((r) => r.name).filter((n) => chosen.has(n))
}

/**
 * Is a recipe in a region you chose? A recipe with no cuisine, or one that belongs to no region (one you wrote yourself), always
 * counts, since there is nothing to hold against it.
 */
export function isPreferred(cuisine: string | null | undefined, preferredRegions: string[]): boolean {
  const region = cuisineRegion(cuisine)
  return !region || preferredRegions.includes(region)
}

export function isFamiliar(cuisine: string | null | undefined): boolean {
  return !cuisine || FAMILIAR.has(cuisine)
}
