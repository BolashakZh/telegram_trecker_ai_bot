import { Bot } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import { registerAdmin } from './handlers/admin.ts'
import { registerUser, type BotDeps } from './handlers/user.ts'

export type { BotDeps }

export function createBot(token: string, deps: BotDeps, botInfo?: UserFromGetMe): Bot {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined)

  bot.catch((err) => {
    console.error('bot error', err.error)
    const ctx = err.ctx
    if (ctx.callbackQuery) {
      void ctx.answerCallbackQuery({ text: 'Бірдеңе дұрыс болмады, қайта көріңіз' })
    } else if (ctx.chat) {
      void ctx.reply('Бірдеңе дұрыс болмады, қайта көріңіз')
    }
  })

  registerAdmin(bot, deps)
  registerUser(bot, deps)
  return bot
}
