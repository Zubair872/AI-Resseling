import { closeDatabase } from './db.js'
import { applyMigration } from './migration.js'

await applyMigration()
await closeDatabase()
console.log('Database migration applied')
