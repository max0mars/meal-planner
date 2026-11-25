export type Sensitivity = 'safe' | 'light' | 'major'
export type Unit = 'g' | 'ml' | 'tbsp' | 'tsp' | 'cup' | 'piece'
export type StorageLocation = 'fridge' | 'freezer' | 'pantry'

export interface Ingredient {
  id?: number
  name: string
  aliases: string[]
  category: string
  /** Allergen / intolerance categories (see src/data/tags.ts). */
  tags: string[]
  /** Default shelf life in days from purchase, per storage location. */
  shelfLifeDays: Partial<Record<StorageLocation, number>>
  kcalPer100g: number
  proteinPer100g: number
  sensitivity: Sensitivity
  /** Max share of a recipe's total ingredient weight (0-1) before a light-sensitivity item excludes the recipe. */
  /** A limit for this food alone. When missing, the default limit from Settings applies. */
  lightThresholdPct?: number
  /** USDA FoodData Central id, when seeded from USDA. */
  usdaId?: number
  /** Typical weight of one piece (an egg, a clove of garlic, a slice of bread). */
  gramsPerPiece?: number
  /** Grams per millilitre, for converting cups/tbsp/tsp. Falls back to a category default. */
  gramsPerMl?: number
  /** True for foods you added yourself. Only these can be renamed or deleted. */
  custom?: boolean
  /** The product's barcode (EAN-13), when the food was added by scanning it. */
  barcode?: string
}

/** Your sensitivity level for a whole category (e.g. gluten = major). Missing row = safe. */
export interface TagSensitivity {
  tag: string
  sensitivity: Sensitivity
}

export interface PantryItem {
  id?: number
  ingredientId: number
  qty: number
  unit: Unit
  purchasedOn: string // ISO date
  expiresOn: string // ISO date; defaults to purchasedOn + shelf life, overridable
  location: StorageLocation
}

export interface RecipeIngredient {
  ingredientId: number
  qty: number
  unit: Unit
}

export interface Recipe {
  id?: number
  title: string
  servings: number
  /** How many servings you actually eat in one meal (calibrated over time). */
  servingsPerMeal: number
  ingredients: RecipeIngredient[]
  steps: string[]
  estMinutes: number
  actualMinutesHistory: number[]
  /** Where the recipe came from (a web address), shown as a link. */
  source?: string
  /** Set on baseline recipes that shipped with the app, so they are never added twice. */
  seedId?: string
  /** A rough kind of dish, such as Beef or Dessert. */
  category?: string
  /** True while servings is the app's guess (imported recipes) rather than a number you or the recipe gave. */
  servingsEstimated?: boolean
  /** True while stMinutes is the app's placeholder (imported recipes) rather than a time the recipe gave. */
  timeEstimated?: boolean
  /** One plain-English sentence about the dish, so a name you don't know still tells you what it is. */
  description?: string
  /** Where the dish comes from, such as "British" or "Dutch". */
  cuisine?: string
  /** Your verdict. A disliked recipe is never suggested by the planner. */
  rating?: 'like' | 'dislike'
}

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

/** What a meal slot is for when no recipe has been chosen: eat leftovers, eat out, something quick, or let the planner choose. */
export type SlotConstraint = 'leftovers' | 'out' | 'quick' | 'any'

export interface MealPlanEntry {
  id?: number
  date: string
  slot: MealSlot
  /** Missing while the slot is a constraint that has not been filled yet, or when you are eating out. */
  recipeId?: number
  servingsPlanned: number
  status: 'planned' | 'cooked' | 'skipped'
  /** What you asked for. Kept after the planner fills the slot, so planning again keeps it. */
  constraint?: SlotConstraint
  /** When you eat this meal (HH:MM), if not the usual time for the slot. */
  eatAt?: string
  /** When you start cooking (HH:MM), if not worked out from the recipe's time. */
  cookAt?: string
  /** Set when the meal this was eaten as leftovers from was deleted, so it now needs cooking itself. Cleared when you change or dismiss it. */
  cookDeleted?: boolean
}

/** A grocery trip, placed before, between or after the day's meals. */
export interface Trip {
  id?: number
  date: string
  /** The meal it comes after, or 'start' for before the first meal of the day. */
  after: MealSlot | 'start'
  time: string
  note?: string
}

export interface Leftover {
  id?: number
  recipeId: number
  servingsLeft: number
  cookedOn: string
  expiresOn: string
}

export interface MealLog {
  id?: number
  date: string
  recipeId?: number
  leftoverId?: number
  servingsEaten: number
  kcal: number
  protein: number
  flareUp?: boolean
}

export interface Settings {
  id: 1
  kcalTarget: number
  proteinTarget: number
  /** Default light-sensitivity cap as a share of recipe weight. */
  defaultLightThresholdPct: number
  /** Combined cap across all light-sensitivity ingredients in one recipe. */
  combinedLightCapPct: number
  leftoverShelfLifeDays: number
  /** Which release of the baseline recipe set has been added, so deleted recipes are not brought back. */
  baselineRecipesVersion?: number
  /** Every starter recipe ever added, including ones since deleted, so a deleted recipe never comes back. */
  baselineSeedIds?: string[]
  /** Which meals of the day you plan, such as lunch and dinner. */
  planSlots?: MealSlot[]
  /** The usual time you eat each meal (HH:MM). */
  mealTimes?: Record<MealSlot, string>
  /** A recipe counts as quick if it takes this many minutes or fewer. */
  quickMinutes?: number
  /** Whether the planner leans towards your chosen cuisines. True whenever `preferredCuisines` has any. Kept for older installs. */
  preferFamiliar?: boolean
  /** The regions of cuisine the planner leans towards, such as "British & Irish" (see CUISINE_REGIONS). Empty means every cuisine is treated equally. */
  preferredCuisines?: string[]
  /** Whether times are shown as 6:30 PM or 18:30. They are always stored as HH:MM. */
  timeFormat?: '12h' | '24h'
}
