import { createBot } from '../lib/bot.ts'
import { config } from '../lib/config.ts'
import { migrate, neonDb } from '../lib/db.ts'

const db = neonDb(config.databaseUrl(), config.tz())
await migrate(db)

const bot = createBot(config.botToken(), {
  db, adminIds: config.adminIds(), appUrl: config.appUrl(),
})

await bot.api.deleteWebhook()
console.log('long polling запущен, Ctrl+C для выхода')
await bot.start()
