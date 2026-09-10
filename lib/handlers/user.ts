import type { Bot, Context } from 'grammy'
import type { Db } from '../db.ts'
import { today } from '../db.ts'
import {
  clearPending, dayState, parseNumber, setPending, setValue, takePending, toggleCheck,
} from '../entries.ts'
import { userGroups } from '../groups.ts'
import { groupReport, missingToday } from '../group-stats.ts'
import { groupScreen, groupsKeyboard, infoScreen, mainScreen, statsScreen } from '../menu.ts'
import { userStats, weekStart } from '../stats.ts'
import { activeTrackersForUser } from '../trackers.ts'
import { num } from '../text.ts'
import { setDisplayName, upsertFromTelegram } from '../users.ts'

export type BotDeps = { db: Db; adminIds: number[]; appUrl: string }

export async function showMain(
  ctx: Context, deps: BotDeps, opts: { edit?: boolean } = {},
): Promise<void> {
  const userId = ctx.from!.id
  const day = await today(deps.db)
  const trackers = await activeTrackersForUser(deps.db, userId)
  const state = await dayState(deps.db, userId, day)
  const { text, keyboard } = mainScreen({ day, trackers, state })

  if (opts.edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' })
  } else {
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' })
  }
}

async function notifyAdmins(ctx: Context, deps: BotDeps, name: string): Promise<void> {
  const u = ctx.from!
  const text = `Новый участник: ${name} (@${u.username ?? '—'}, ${u.id})\nНазначьте ему группы.`
  for (const adminId of deps.adminIds) {
    // Изолируем рассылку: если один админ заблокировал бота, sendMessage бросит
    // исключение — не даём ему прервать цикл (остальные админы должны узнать)
    // и не даём ему всплыть в bot.catch (человек, который только что назвал
    // себя, не должен увидеть «Что-то пошло не так»).
    try {
      await ctx.api.sendMessage(adminId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: '⚙️ Открыть админку', web_app: { url: `${deps.appUrl}/admin` } }]],
        },
      })
    } catch (err) {
      console.error('notifyAdmins: failed to notify', adminId, err)
    }
  }
}

export function registerUser(bot: Bot, deps: BotDeps): void {
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data
    const userId = ctx.from.id
    const day = await today(deps.db)

    if (data.startsWith('t:')) {
      const trackerId = Number(data.slice(2))
      const trackers = await activeTrackersForUser(deps.db, userId)
      const tracker = trackers.find((t) => t.id === trackerId)
      if (!tracker) {
        await ctx.answerCallbackQuery({ text: 'Трекер больше не активен' })
        await showMain(ctx, deps, { edit: true })
        return
      }

      if (tracker.kind === 'number') {
        await setPending(deps.db, userId, tracker.id)
        await ctx.answerCallbackQuery()
        const about = tracker.description ? ` — ${tracker.description}` : ''
        await ctx.reply(
          `${tracker.title}${about}. Сколько сегодня? Пришлите число (цель ${num(tracker.target)} ${tracker.unit ?? ''}).`.replace(/\s+\)/, ')'),
          { reply_markup: { force_reply: true } },
        )
        return
      }

      const { done } = await toggleCheck(deps.db, userId, tracker.id, day)
      await ctx.answerCallbackQuery({ text: done ? 'Отмечено ✅' : 'Снято' })
      await showMain(ctx, deps, { edit: true })
      return
    }

    if (data === 's:me') {
      await ctx.answerCallbackQuery()
      const stats = await userStats(deps.db, userId, day)
      await ctx.editMessageText(statsScreen(stats), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '← Назад', callback_data: 'back' }]] },
      })
      return
    }

    if (data === 's:info') {
      await ctx.answerCallbackQuery()
      const trackers = await activeTrackersForUser(deps.db, userId)
      await ctx.editMessageText(infoScreen(trackers), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '← Назад', callback_data: 'back' }]] },
      })
      return
    }

    if (data === 's:g' || data.startsWith('s:g:')) {
      await ctx.answerCallbackQuery()
      const groups = await userGroups(deps.db, userId)
      if (groups.length === 0) {
        await ctx.editMessageText('Вы пока не состоите ни в одной группе.')
        return
      }

      const chosen = data.startsWith('s:g:')
        ? groups.find((g) => g.id === Number(data.slice(4)))
        : groups.length === 1 ? groups[0] : undefined

      if (!chosen) {
        await ctx.editMessageText('Выберите группу:', {
          reply_markup: groupsKeyboard(groups, 's:g:'),
        })
        return
      }

      const report = await groupReport(deps.db, chosen.id, weekStart(day), day)
      const missing = await missingToday(deps.db, chosen.id, day)
      await ctx.editMessageText(groupScreen(report, userId, missing), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '← Назад', callback_data: 'back' }]] },
      })
      return
    }

    if (data === 'back') {
      await ctx.answerCallbackQuery()
      await showMain(ctx, deps, { edit: true })
    }
  })

  bot.on('message:text', async (ctx) => {
    const tg = ctx.from
    const user = await upsertFromTelegram(deps.db, {
      id: tg.id, username: tg.username, first_name: tg.first_name,
    })
    const text = ctx.message.text.trim()

    // 1. Нет имени — всё, что человек пишет, считается ответом на вопрос об имени.
    if (!user.display_name) {
      if (text === '/start') {
        await ctx.reply('Здравствуйте! Как вас зовут? Напишите имя и фамилию — так в группе поймут, кто вы.')
        return
      }
      const res = await setDisplayName(deps.db, tg.id, text, { byAdmin: false })
      if (!res.ok) {
        await ctx.reply('Напишите имя буквами, например: Айгуль Смагулова')
        return
      }
      await ctx.reply(`Приятно познакомиться, ${res.name}!`)
      await notifyAdmins(ctx, deps, res.name)
      await showMain(ctx, deps)
      return
    }

    // 2. Ждём число по конкретному трекеру.
    const pendingId = await takePending(deps.db, tg.id)
    if (pendingId !== null && !text.startsWith('/')) {
      const value = parseNumber(text)
      if (value === null) {
        await ctx.reply('Нужно число, например 12')
        return
      }
      const trackers = await activeTrackersForUser(deps.db, tg.id)
      const tracker = trackers.find((t) => t.id === pendingId)
      await clearPending(deps.db, tg.id)
      if (!tracker) {
        await ctx.reply('Трекер больше не активен')
        await showMain(ctx, deps)
        return
      }
      const day = await today(deps.db)
      const res = await setValue(deps.db, tg.id, tracker.id, day, value)
      await ctx.reply(
        res.cleared
          ? `Отметка снята: ${tracker.title}`
          : `Записано: ${num(value)} ${tracker.unit ?? ''} ${res.done ? '✅' : ''} (цель ${num(tracker.target)})`.trim(),
      )
      await showMain(ctx, deps)
      return
    }

    // 3. Смена имени.
    if (text.startsWith('/name')) {
      const raw = text.slice('/name'.length).trim()
      const res = await setDisplayName(deps.db, tg.id, raw, { byAdmin: false })
      if (res.ok) await ctx.reply(`Готово, теперь вы ${res.name}`)
      else if (res.reason === 'locked') await ctx.reply('Ваше имя задал администратор, напишите ему')
      else await ctx.reply('Напишите так: /name Айгуль Смагулова')
      return
    }

    // 4. Всё остальное открывает главный экран.
    await showMain(ctx, deps)
  })
}
