import { readFile } from 'node:fs/promises'
import { query } from './db.js'

let migrationPromise: Promise<void> | undefined

export function applyMigration() {
  migrationPromise ??= readFile(new URL('../db/001_initial.sql', import.meta.url), 'utf8')
    .then((migration) => query(migration))
    .then(() => undefined)
  return migrationPromise
}
