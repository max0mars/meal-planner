-- Dexie (the old browser database) had no foreign keys, and the app's deletes and clears rely on that.
-- D1 enforces foreign keys by default, so the four tables that had them are rebuilt without them.
-- Only safe while these tables are empty: it drops and recreates them. Later schema changes must not do this.

DROP TABLE pantry_items;
CREATE TABLE pantry_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ingredient_id INTEGER NOT NULL,
  qty REAL NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('g', 'ml', 'tbsp', 'tsp', 'cup', 'piece')),
  purchased_on TEXT NOT NULL,
  expires_on TEXT NOT NULL,
  location TEXT NOT NULL CHECK (location IN ('fridge', 'freezer', 'pantry'))
);
CREATE INDEX pantry_items_ingredient ON pantry_items (ingredient_id);
CREATE INDEX pantry_items_expires ON pantry_items (expires_on);

DROP TABLE meal_plan;
CREATE TABLE meal_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_id INTEGER,
  foods TEXT,
  out_kcal REAL,
  out_protein REAL,
  servings_planned REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'cooked', 'skipped')),
  slot_constraint TEXT CHECK (slot_constraint IS NULL OR slot_constraint IN ('leftovers', 'out', 'quick', 'any')),
  eat_at TEXT,
  cook_deleted INTEGER,
  used_pantry TEXT,
  borrowed TEXT
);
CREATE INDEX meal_plan_date ON meal_plan (date);
CREATE INDEX meal_plan_recipe ON meal_plan (recipe_id);

DROP TABLE leftovers;
CREATE TABLE leftovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id INTEGER NOT NULL,
  servings_left REAL NOT NULL,
  cooked_on TEXT NOT NULL,
  expires_on TEXT NOT NULL
);
CREATE INDEX leftovers_recipe ON leftovers (recipe_id);
CREATE INDEX leftovers_expires ON leftovers (expires_on);

DROP TABLE meal_logs;
CREATE TABLE meal_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  recipe_id INTEGER,
  leftover_id INTEGER,
  servings_eaten REAL NOT NULL,
  kcal REAL NOT NULL,
  protein REAL NOT NULL,
  flare_up INTEGER
);
CREATE INDEX meal_logs_date ON meal_logs (date);
