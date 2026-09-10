import type { Bot } from 'grammy'
import { bindChat, listGroups } from '../groups.ts'
import { groupsKeyboard } from '../menu.ts'
import type { BotDeps } from './user.ts'

export function registerAdmin(bot: Bot, deps: BotDeps): void {
  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text.trim()
    if (text.startsWith('/bind')) {
      if (!deps.adminIds.includes(ctx.from!.id)) return
      const groups = await listGroups(deps.db)
      if (groups.length === 0) {
        await ctx.reply('Сначала создайте группу в админке.')
        return
      }
      await ctx.reply('К какой группе привязать этот чат?', {
        reply_markup: groupsKeyboard(groups, 'b:'),
      })
      return
    }
    await next()
  })

  bot.callbackQuery(/^b:(\d+)$/, async (ctx) => {
    if (!deps.adminIds.includes(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: 'Только для админов' })
      return
    }
    const groupId = Number(ctx.match![1])
    const chatId = ctx.chat!.id

    // Проверяем, что группа активна
    const allGroups = await listGroups(deps.db, { includeArchived: true })
    const group = allGroups.find((g) => g.id === groupId)

    if (!group || group.archived_at !== null) {
      await ctx.answerCallbackQuery({ text: 'Группа больше не активна' })
      await ctx.editMessageText('Группа архивирована и больше не доступна.')
      return
    }

    await bindChat(deps.db, groupId, chatId)
    await ctx.answerCallbackQuery({ text: 'Привязано' })
    await ctx.editMessageText(`Чат привязан к группе «${group.title}». Итоги недели буду присылать сюда по воскресеньям.`)
  })
}
