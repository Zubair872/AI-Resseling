import pg from 'pg'
import { PGlite } from '@electric-sql/pglite'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { config } from './config.js'

type QueryResult<T extends pg.QueryResultRow> = { rows: T[]; rowCount: number | null }
type DatabaseClient = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>
  release: () => void
}
type DatabasePool = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>
  connect(): Promise<DatabaseClient>
  end?(): Promise<void>
}

class EmbeddedClient implements DatabaseClient {
  constructor(private readonly database: PGlite) {}

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
    const result = await this.database.query<T>(text, values)
    return { rows: result.rows, rowCount: result.affectedRows ?? null }
  }

  release() {}
}

class EmbeddedPool {
  constructor(private readonly database: PGlite) {}

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
    return new EmbeddedClient(this.database).query<T>(text, values)
  }

  async connect() {
    return new EmbeddedClient(this.database)
  }
}

const inMemoryDatabase = config.LOCAL_DB_PATH.startsWith('memory://')
const localDatabasePath = inMemoryDatabase ? config.LOCAL_DB_PATH : resolve(config.LOCAL_DB_PATH)
if (!config.DATABASE_URL && !inMemoryDatabase) await mkdir(dirname(localDatabasePath), { recursive: true })
const database = config.DATABASE_URL ? new pg.Pool({ connectionString: config.DATABASE_URL }) : new PGlite(localDatabasePath)
export const usingEmbeddedDatabase = !config.DATABASE_URL
export const pool: DatabasePool = config.DATABASE_URL ? database as unknown as DatabasePool : new EmbeddedPool(database as PGlite)

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []) {
  if (usingEmbeddedDatabase && text.includes(';')) {
    await (database as PGlite).exec(text)
    return { rows: [] as T[], rowCount: null }
  }
  return pool.query<T>(text, values)
}

export async function closeDatabase() {
  if (pool.end) await pool.end()
  else await (database as PGlite).close()
}
