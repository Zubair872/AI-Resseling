import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { query } from './db.js'

const migrationFiles = ['001_initial.sql', '002_rules.sql', '003_auth_notifications.sql', '004_integrations_sourcing.sql', '005_customer_chat.sql', '006_billing_team.sql', '007_agents_uploads.sql', '008_providers_storage.sql', '009_oauth_templates_marketplace.sql', '010_autopilot.sql', '011_free_channels.sql', '012_markaz_auto.sql', '013_markaz_export_variants.sql', '014_order_variants_and_chat.sql']
let migrationPromise: Promise<void> | undefined

export function applyMigration() {
  migrationPromise ??= (async () => {
    for (const file of migrationFiles) {
      const sql = await readFile(resolve('db', file), 'utf8')
      await query(sql)
    }
  })()
  return migrationPromise
}
