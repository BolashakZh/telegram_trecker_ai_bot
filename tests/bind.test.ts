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

  it('не-админа игнорирует', async () => {
    const { db, bot, calls } = await harness()
    await createGroup(db, 'Утро')

    await bot.handleUpdate(groupMessage('/bind', 7))
    expect(calls).toHaveLength(0)
    expect((await listGroups(db))[0].chat_id).toBeNull()
  })
})
