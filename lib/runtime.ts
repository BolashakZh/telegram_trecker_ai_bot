import type { Bot } from 'grammy'
import { createBot } from './bot.ts'
import { config } from './config.ts'
import { neonDb, type Db } from './db.ts'

let db: Db | null = null
let bot: Bot | null = null

export function getDb(): Db {
  db ??= neonDb(config.databaseUrl(), config.tz())
  return db
}

export function getBot(): Bot {
  bot ??= createBot(config.botToken(), {
    db: getDb(), adminIds: config.adminIds(), appUrl: config.appUrl(),
  })
  return bot
}
