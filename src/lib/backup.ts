import { db, type MealPlannerDB } from '../db'

/** Every table, in an order where a failed restore leaves nothing half-written (it all happens in one transaction). */
const TABLES = ['ingredients', 'pantryItems', 'recipes', 'mealPlan', 'leftovers', 'mealLogs', 'settings', 'trips', 'tagSensitivities'] as const

export const BACKUP_FORMAT = 'meal-planner-backup'

export interface Backup {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  tables: Record<(typeof TABLES)[number], unknown[]>
}

/** Everything you entered, as one JSON file. Photos are never stored by the app, so there are none to include. */
export async function exportBackup(database: MealPlannerDB = db): Promise<Backup> {
  const tables = {} as Backup['tables']
  for (const name of TABLES) tables[name] = await database.table(name).toArray()
  return { format: BACKUP_FORMAT, version: database.verno, exportedAt: new Date().toISOString(), tables }
}

export class BackupError extends Error {}

/** Throws a plain-English BackupError if the text is not a backup this app wrote. */
export function parseBackup(text: string): Backup {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new BackupError('That file is not a backup: it is not valid JSON.')
  }
  const b = data as Partial<Backup> | null
  if (!b || b.format !== BACKUP_FORMAT || typeof b.tables !== 'object' || b.tables === null) {
    throw new BackupError('That file is not a Meal Planner backup.')
  }
  for (const name of TABLES) {
    if (!Array.isArray(b.tables[name])) throw new BackupError(`The backup is missing its “${name}” list, so it may be damaged. Nothing was changed.`)
  }
  if (typeof b.version === 'number' && b.version > 100) throw new BackupError('That backup is from a different app version. Nothing was changed.')
  return b as Backup
}

/** Replaces everything with the backup, all or nothing. Returns what was restored. */
export async function restoreBackup(backup: Backup, database: MealPlannerDB = db): Promise<{ recipes: number; pantryItems: number }> {
  const tables = TABLES.map((t) => database.table(t))
  await database.transaction('rw', tables, async () => {
    for (const t of tables) await t.clear()
    for (const name of TABLES) {
      const rows = backup.tables[name]
      if (rows.length > 0) await database.table(name).bulkAdd(rows)
    }
  })
  return { recipes: backup.tables.recipes.length, pantryItems: backup.tables.pantryItems.length }
}

export function backupFileName(now = new Date()): string {
  return `meal-planner-backup-${now.toISOString().slice(0, 10)}.json`
}
