import { app, deliverJob, planLimits, sourcingSettings } from './app.js'
import { runMarkazAutoForEnabledTenants } from './markazAuto.js'
import { dispatchDueLocalJobs } from './localRoutes.js'
import { runAutopilotForEnabledTenants } from './autopilotRoutes.js'
import { config } from './config.js'
import { sweepExpiredSubscriptions } from './billingRoutes.js'

try {
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

// Hourly: move expired or cancelled paid plans to the free Starter plan.
const sweepTimer = setInterval(() => { sweepExpiredSubscriptions().catch((error) => app.log.error(error)) }, 60 * 60 * 1000)
sweepTimer.unref()
// Hourly: workspaces with Autopilot on get today and tomorrow filled up to each account's daily limit.
const autopilotTimer = setInterval(() => { runAutopilotForEnabledTenants(deliverJob).catch((error) => app.log.error(error)) }, 60 * 60 * 1000)
autopilotTimer.unref()

// Every 30 seconds: send posts for Bluesky/Mastodon/Discord whose time has come (these channels have no scheduler of their own).
const localTimer = setInterval(() => { dispatchDueLocalJobs().catch((error) => app.log.error(error)) }, 30 * 1000)
localTimer.unref()
dispatchDueLocalJobs().catch((error) => app.log.error(error))

// Every 30 minutes: workspaces with Markaz auto on pick new Markaz products and post them (each workspace at most once every 3 hours).
const markazDeps = { sourcingSettings, planLimits, deliver: deliverJob }
const markazTimer = setInterval(() => { runMarkazAutoForEnabledTenants(markazDeps).catch((error) => app.log.error(error)) }, 30 * 60 * 1000)
markazTimer.unref()
setTimeout(() => { runMarkazAutoForEnabledTenants(markazDeps).catch((error) => app.log.error(error)) }, 60 * 1000).unref()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close()
    process.exit(0)
  })
}
