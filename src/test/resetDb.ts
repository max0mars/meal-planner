// Tests share one database (the test server's). This empties it, so each test starts from nothing.
import { db } from '../db'

const TABLE_NAMES = ['ingredients', 'pantryItems', 'recipes', 'mealPlan', 'leftovers', 'mealLogs', 'settings', 'trips', 'tagSensitivities'] as const

export async function freshDatabase() {
  for (const name of TABLE_NAMES) await db.table(name).clear()
  return db
}
