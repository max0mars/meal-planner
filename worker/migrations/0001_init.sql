-- Mirrors the Dexie tables in src/db.ts (versions 1-3).
-- Scalar fields are real columns; arrays and nested objects are JSON text.
-- Booleans are INTEGER 0/1. Ids are kept from the app, so existing references still work.

CREATE TABLE ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',          -- JSON array of strings
  category TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',             -- JSON array of strings
  shelf_life_days TEXT NOT NULL DEFAULT '{}',  -- JSON {fridge?, freezer?, pantry?}
  kcal_per_100g REAL NOT NULL,
  protein_per_100g REAL NOT NULL,
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('safe', 'light', 'major')),
  light_threshold_pct REAL,
  usda_id INTEGER,
  grams_per_piece REAL,
  grams_per_ml REAL,
  custom INTEGER,
  barcode TEXT
);
CREATE INDEX ingredients_name ON ingredients (name);
CREATE INDEX ingredients_category ON ingredients (category);
CREATE INDEX ingredients_barcode ON ingredients (barcode);

CREATE TABLE tag_sensitivities (
  tag TEXT PRIMARY KEY,
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('safe', 'light', 'major'))
);

CREATE TABLE pantry_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients (id),
  qty REAL NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'tbsp', 'tsp', 'cup', 'piece')),
  purchased_on TEXT NOT NULL,                  -- ISO date
  expires_on TEXT NOT NULL,                    -- ISO date
  location TEXT NOT NULL CHECK (location IN ('fridge', 'freezer', 'pantry'))
);
CREATE INDEX pantry_items_ingredient ON pantry_items (ingredient_id);
CREATE INDEX pantry_items_expires ON pantry_items (expires_on);

CREATE TABLE recipes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  servings REAL NOT NULL,
  servings_per_meal REAL NOT NULL,
  ingredients TEXT NOT NULL DEFAULT '[]',      -- JSON RecipeIngredient[]
  steps TEXT NOT NULL DEFAULT '[]',            -- JSON string[]
  est_minutes REAL NOT NULL,
  actual_minutes_history TEXT NOT NULL DEFAULT '[]', -- JSON number[]
  source TEXT,
  seed_id TEXT,
  category TEXT,
  servings_estimated INTEGER,
  time_estimated INTEGER,
  description TEXT,
  cuisine TEXT,
  rating TEXT CHECK (rating IS NULL OR rating IN ('like', 'dislike')),
  adhoc INTEGER
);
CREATE INDEX recipes_title ON recipes (title);
CREATE INDEX recipes_seed_id ON recipes (seed_id);

CREATE TABLE meal_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                          -- ISO date
  slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_id INTEGER REFERENCES recipes (id),
  foods TEXT,                                  -- JSON RecipeIngredient[], for meals of plain foods
  out_kcal REAL,
  out_protein REAL,
  servings_planned REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'cooked', 'skipped')),
  slot_constraint TEXT CHECK (slot_constraint IS NULL OR slot_constraint IN ('leftovers', 'out', 'quick', 'any')),
  eat_at TEXT,                                 -- HH:MM
  cook_deleted INTEGER,
  used_pantry TEXT,                            -- JSON UsedPantry[]
  borrowed TEXT                                -- JSON number[]
);
CREATE INDEX meal_plan_date ON meal_plan (date);
CREATE INDEX meal_plan_recipe ON meal_plan (recipe_id);

CREATE TABLE leftovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL REFERENCES recipes (id),
  servings_left REAL NOT NULL,
  cooked_on TEXT NOT NULL,
  expires_on TEXT NOT NULL
);
CREATE INDEX leftovers_recipe ON leftovers (recipe_id);
CREATE INDEX leftovers_expires ON leftovers (expires_on);

CREATE TABLE meal_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  recipe_id INTEGER REFERENCES recipes (id),
  leftover_id INTEGER REFERENCES leftovers (id),
  servings_eaten REAL NOT NULL,
  kcal REAL NOT NULL,
  protein REAL NOT NULL,
  flare_up INTEGER
);
CREATE INDEX meal_logs_date ON meal_logs (date);

-- One row only (id = 1), as in the app.
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  kcal_target REAL NOT NULL,
  protein_target REAL NOT NULL,
  default_light_threshold_pct REAL NOT NULL,
  combined_light_cap_pct REAL NOT NULL,
  leftover_shelf_life_days REAL NOT NULL,
  baseline_recipes_version INTEGER,
  baseline_seed_ids TEXT,                      -- JSON string[]
  plan_slots TEXT,                             -- JSON MealSlot[]
  meal_times TEXT,                             -- JSON Record<MealSlot, HH:MM>
  quick_minutes REAL,
  prefer_familiar INTEGER,
  preferred_cuisines TEXT,                     -- JSON string[]
  time_format TEXT CHECK (time_format IS NULL OR time_format IN ('12h', '24h'))
);

CREATE TABLE trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  after_slot TEXT NOT NULL CHECK (after_slot IN ('start', 'breakfast', 'lunch', 'dinner', 'snack')),
  time TEXT NOT NULL,                          -- HH:MM
  note TEXT
);
CREATE INDEX trips_date ON trips (date);
