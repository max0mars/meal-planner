// Maps each app table (named as in src/db.ts) to its SQL table and fields.
// `key` is the field name the app uses; `col` is the column in migrations/0001_init.sql.

export type Kind = 'text' | 'num' | 'bool' | 'json'

export interface Field {
  key: string
  col: string
  kind: Kind
}

export interface TableDef {
  sql: string
  /** The primary key field. `auto`: integer id set by the database. `text`: a text key. `fixed`: the single settings row (id 1). */
  pk: string
  pkKind: 'auto' | 'text' | 'fixed'
  fields: Field[]
}

const f = (key: string, col: string, kind: Kind): Field => ({ key, col, kind })

export const TABLES: Record<string, TableDef> = {
  ingredients: {
    sql: 'ingredients',
    pk: 'id',
    pkKind: 'auto',
    fields: [
      f('name', 'name', 'text'),
      f('aliases', 'aliases', 'json'),
      f('category', 'category', 'text'),
      f('tags', 'tags', 'json'),
      f('shelfLifeDays', 'shelf_life_days', 'json'),
      f('kcalPer100g', 'kcal_per_100g', 'num'),
      f('proteinPer100g', 'protein_per_100g', 'num'),
      f('sensitivity', 'sensitivity', 'text'),
      f('lightThresholdPct', 'light_threshold_pct', 'num'),
      f('usdaId', 'usda_id', 'num'),
      f('gramsPerPiece', 'grams_per_piece', 'num'),
      f('gramsPerMl', 'grams_per_ml', 'num'),
      f('custom', 'custom', 'bool'),
      f('barcode', 'barcode', 'text'),
    ],
  },
  tagSensitivities: {
    sql: 'tag_sensitivities',
    pk: 'tag',
    pkKind: 'text',
    fields: [f('sensitivity', 'sensitivity', 'text')],
  },
  pantryItems: {
    sql: 'pantry_items',
    pk: 'id',
    pkKind: 'auto',
    fields: [
      f('ingredientId', 'ingredient_id', 'num'),
      f('qty', 'qty', 'num'),
      f('unit', 'unit', 'text'),
      f('purchasedOn', 'purchased_on', 'text'),
      f('expiresOn', 'expires_on', 'text'),
      f('location', 'location', 'text'),
    ],
  },
  recipes: {
    sql: 'recipes',
    pk: 'id',
    pkKind: 'auto',
    fields: [
      f('title', 'title', 'text'),
      f('servings', 'servings', 'num'),
      f('servingsPerMeal', 'servings_per_meal', 'num'),
      f('ingredients', 'ingredients', 'json'),
      f('steps', 'steps', 'json'),
      f('estMinutes', 'est_minutes', 'num'),
      f('actualMinutesHistory', 'actual_minutes_history', 'json'),
      f('source', 'source', 'text'),
      f('seedId', 'seed_id', 'text'),
      f('category', 'category', 'text'),
      f('servingsEstimated', 'servings_estimated', 'bool'),
      f('timeEstimated', 'time_estimated', 'bool'),
      f('description', 'description', 'text'),
      f('cuisine', 'cuisine', 'text'),
      f('rating', 'rating', 'text'),
      f('adhoc', 'adhoc', 'bool'),
    ],
  },
  mealPlan: {
    sql: 'meal_plan',
    pk: 'id',
    pkKind: 'auto',
    fields: [
      f('date', 'date', 'text'),
      f('slot', 'slot', 'text'),
      f('recipeId', 'recipe_id', 'num'),
      f('foods', 'foods', 'json'),
      f('outKcal', 'out_kcal', 'num'),
      f('outProtein', 'out_protein', 'num'),
      f('servingsPlanned', 'servings_planned', 'num'),
      f('status', 'status', 'text'),
      f('constraint', 'slot_constraint', 'text'),
      f('eatAt', 'eat_at', 'text'),
      f('cookDeleted', 'cook_deleted', 'bool'),
      f('usedPantry', 'used_pantry', 'json'),
      f('borrowed', 'borrowed', 'json'),
    ],
  },
  leftovers: {
    sql: 'leftovers',
    pk: 'id',
    pkKind: 'auto',
    fields: [
      f('recipeId', 'recipe_id', 'num'),
      f('servingsLeft', 'servings_left', 'num'),
      f('cookedOn', 'cooked_on', 'text'),
      f('expiresOn', 'expires_on', 'text'),
    ],
  },
  mealLogs: {
    sql: 'meal_logs',
    pk: 'id',
    pkKind: 'auto',
    fields: [
      f('date', 'date', 'text'),
      f('recipeId', 'recipe_id', 'num'),
      f('leftoverId', 'leftover_id', 'num'),
      f('servingsEaten', 'servings_eaten', 'num'),
      f('kcal', 'kcal', 'num'),
      f('protein', 'protein', 'num'),
      f('flareUp', 'flare_up', 'bool'),
    ],
  },
  trips: {
    sql: 'trips',
    pk: 'id',
    pkKind: 'auto',
    fields: [
      f('date', 'date', 'text'),
      f('after', 'after_slot', 'text'),
      f('time', 'time', 'text'),
      f('note', 'note', 'text'),
    ],
  },
  settings: {
    sql: 'settings',
    pk: 'id',
    pkKind: 'fixed',
    fields: [
      f('kcalTarget', 'kcal_target', 'num'),
      f('proteinTarget', 'protein_target', 'num'),
      f('defaultLightThresholdPct', 'default_light_threshold_pct', 'num'),
      f('combinedLightCapPct', 'combined_light_cap_pct', 'num'),
      f('leftoverShelfLifeDays', 'leftover_shelf_life_days', 'num'),
      f('baselineRecipesVersion', 'baseline_recipes_version', 'num'),
      f('baselineSeedIds', 'baseline_seed_ids', 'json'),
      f('planSlots', 'plan_slots', 'json'),
      f('mealTimes', 'meal_times', 'json'),
      f('quickMinutes', 'quick_minutes', 'num'),
      f('preferFamiliar', 'prefer_familiar', 'bool'),
      f('preferredCuisines', 'preferred_cuisines', 'json'),
      f('timeFormat', 'time_format', 'text'),
    ],
  },
}

export const TABLE_NAMES = Object.keys(TABLES)
