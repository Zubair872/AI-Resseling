import { readFile } from 'node:fs/promises'
import { query, closeDatabase } from './db.js'

const migration = await readFile(new URL('../db/001_initial.sql', import.meta.url), 'utf8')
await query(migration)
await closeDatabase()
console.log('Database migration applied')
