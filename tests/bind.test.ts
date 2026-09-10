import { describe, expect, it } from 'vitest'
import type { Update } from 'grammy/types'
import { createBot } from '../lib/bot.ts'
import { createGroup, listGroups } from '../lib/groups.ts'
import { testDb } from './helpers.ts'

const BOT_INFO = {
  id: 42, is_bot: true as const, first_name: 'Tracker', username: 'tracker_bot',
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false,
  has_topics_enabled: false, allows_users_to_create_topics: false,
  can_manage_bots: false, supports_join_request_queries: false,
}

async function harness() {
  const db = await testDb()
  const calls: { method: string; payload: Record<string, unknown> }[] = []
  const bot = createBot('42:TEST', { db, adminIds: [99], appUrl: 'https://example.com' }, BOT_INFO)
  bot.api.config.use(async (_p, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> })
    return { ok: true, result: { message_id: 1 } } as never
  })
  await bot.init()
  return { db, bot, calls }
}

function groupMessage(text: string, fromId: number, chatId = -100500): Update {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: 1, date: 0, text,
      chat: { id: chatId, type: 'supergroup' as const, title: 'Утро' },
      from: { id: fromId, is_bot: false, first_name: 'Админ' },
    },
  } as Update
}

function groupTap(data: string, fromId: number, chatId = -100500): Update {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: {
      id: 'cb', chat_instance: 'x', data,
      from: { id: fromId, is_bot: false, first_name: 'Админ' },
      message: {
        message_id: 2, date: 0, text: 'выбор',
        chat: { id: chatId, type: 'supergroup' as const, title: 'Утро' },
      },
    },
  } as Update
}

describe('/bind', () => {
  it('админ выбирает группу кнопкой, чат привязывается', async () => {
    const { db, bot, calls } = await harness()
    const g = await createGroup(db, 'Утро')

    await bot.handleUpdate(groupMessage('/bind', 99))
    expect(JSON.stringify(calls.at(-1)?.payload.reply_markup)).toContain(`b:${g.id}`)

    await bot.handleUpdate(groupTap(`b:${g.id}`, 99))
    expect((await listGroups(db))[0].chat_id).toBe(-100500)
  })

  it('команда с суффиксом бота /bind@tracker_bot даёт клавиатуру', async () => {
    const { db, bot, calls } = await harness()
    await createGroup(db, 'Утро')

    await bot.handleUpdate(groupMessage('/bind@tracker_bot', 99))
    expect(JSON.stringify(calls.at(-1)?.payload.reply_markup)).toContain('b:1')
  })

  it('не-админа игнорирует', async () => {
    const { db, bot, calls } = await harness()
    await createGroup(db, 'Утро')

    await bot.handleUpdate(groupMessage('/bind', 7))
    expect(calls).toHaveLength(0)
    expect((await listGroups(db))[0].chat_id).toBeNull()
  })

  it('не-админ нажимает кнопку привязки', async () => {
    const { db, bot, calls } = await harness()
    const g = await createGroup(db, 'Утро')

    // Админ вызывает /bind
    await bot.handleUpdate(groupMessage('/bind', 99))
    expect(JSON.stringify(calls.at(-1)?.payload.reply_markup)).toContain(`b:${g.id}`)

    // Посторонний нажимает кнопку
    calls.length = 0
    await bot.handleUpdate(groupTap(`b:${g.id}`, 7))

    // Проверяем, что ответ об ошибке отправлен
    const answerCall = calls.find((c) => c.method === 'answerCallbackQuery')
    expect(answerCall?.payload.text).toBe('Только для админов')

    // Чат не привязан
    expect((await listGroups(db))[0].chat_id).toBeNull()
  })

  it('при пустом списке групп показывает подсказку', async () => {
    const { bot, calls } = await harness()

    await bot.handleUpdate(groupMessage('/bind', 99))
    const text = String(calls.at(-1)?.payload.text)
    expect(text).toBe('Сначала создайте группу в админке.')
  })

  it('перепривязка переходит от группы A к группе B', async () => {
    const { db, bot, calls } = await harness()
    const g1 = await createGroup(db, 'Утро')
    const g2 = await createGroup(db, 'Вечер')

    // Привязываем к первой группе
    await bot.handleUpdate(groupMessage('/bind', 99))
    await bot.handleUpdate(groupTap(`b:${g1.id}`, 99))
    expect((await listGroups(db)).find((g) => g.id === g1.id)?.chat_id).toBe(-100500)

    // Перепривязываем ко второй группе
    calls.length = 0
    await bot.handleUpdate(groupMessage('/bind', 99))
    await bot.handleUpdate(groupTap(`b:${g2.id}`, 99))

    // Проверяем, что чат только у второй группы
    const groups = await listGroups(db)
    expect(groups.find((g) => g.id === g1.id)?.chat_id).toBeNull()
    expect(groups.find((g) => g.id === g2.id)?.chat_id).toBe(-100500)
  })
})
