import type { Bot } from 'grammy'
import { bindChat, listGroups } from '../groups.ts'
import { groupsKeyboard } from '../menu.ts'
import type { BotDeps } from './user.ts'

export function registerAdmin(bot: Bot, deps: BotDeps): void {
  // Обработчик /bind команды для админов в сообщениях
  bot.on('message:text', async (ctx, next) => {
    const text = ctx.message.text.trim()
    if (text === '/bind') {
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
    // Пропускаем обработку для других сообщений
    await next()
  })

  bot.callbackQuery(/^b:(\d+)$/, async (ctx) => {
    if (!deps.adminIds.includes(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: 'Только для админов' })
      return
    }
    const groupId = Number(ctx.match![1])
    const chatId = ctx.chat!.id
    await bindChat(deps.db, groupId, chatId)
    const group = (await listGroups(deps.db)).find((g) => g.id === groupId)
    await ctx.answerCallbackQuery({ text: 'Привязано' })
    await ctx.editMessageText(`Чат привязан к группе «${group?.title ?? groupId}». Итоги недели буду присылать сюда по воскресеньям.`)
  })
}
