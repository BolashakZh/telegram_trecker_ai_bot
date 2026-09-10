import { describe, expect, it } from 'vitest'
import type { Update } from 'grammy/types'
import { createBot } from '../lib/bot.ts'
import { createGroup, setMembership } from '../lib/groups.ts'
import { archiveTracker, createTracker, setGroupTracker } from '../lib/trackers.ts'
import { getUser, setDisplayName, upsertFromTelegram } from '../lib/users.ts'
import { testDb } from './helpers.ts'

const BOT_INFO = {
  id: 42, is_bot: true as const, first_name: 'Tracker', username: 'tracker_bot',
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false,
  // Поля добавлены поверх фикстуры из брифа: установленный @grammyjs/types
  // требует их в UserFromGetMe, брифа они не касаются (не тестовая семантика).
  has_topics_enabled: false, allows_users_to_create_topics: false,
  can_manage_bots: false, supports_join_request_queries: false,
}

async function harness() {
  const db = await testDb()
  const calls: { method: string; payload: Record<string, unknown> }[] = []
  const bot = createBot('42:TEST', { db, adminIds: [99], appUrl: 'https://example.com' }, BOT_INFO)
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> })
    return { ok: true, result: { message_id: 1 } } as never
  })
  await bot.init()
  return { db, bot, calls }
}

function message(text: string, from = 7): Update {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: 1, date: 0, text,
      chat: { id: from, type: 'private' as const, first_name: 'Ч' },
      from: { id: from, is_bot: false, first_name: 'Человек-паук', username: 'spider' },
    },
  } as Update
}

function tap(data: string, from = 7): Update {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: {
      id: 'cb1', chat_instance: 'x', data,
      from: { id: from, is_bot: false, first_name: 'Ч' },
      message: {
        message_id: 1, date: 0, text: 'меню',
        chat: { id: from, type: 'private' as const, first_name: 'Ч' },
      },
    },
  } as Update
}

describe('онбординг', () => {
  it('новый человек сначала называет имя, и только потом админ получает уведомление', async () => {
    const { db, bot, calls } = await harness()

    await bot.handleUpdate(message('/start'))
    expect(calls.at(-1)?.payload.text).toContain('Как вас зовут')
    expect(calls.some((c) => c.payload.chat_id === 99)).toBe(false)

    await bot.handleUpdate(message('Айгуль Смагулова'))
    expect((await getUser(db, 7))?.display_name).toBe('Айгуль Смагулова')

    const notice = calls.find((c) => c.payload.chat_id === 99)
    expect(notice?.payload.text).toContain('Айгуль Смагулова')
    expect(JSON.stringify(notice?.payload.reply_markup)).toContain('web_app')
  })

  it('невалидное имя не принимается', async () => {
    const { db, bot, calls } = await harness()
    await bot.handleUpdate(message('/start'))
    await bot.handleUpdate(message('!!'))
    expect((await getUser(db, 7))?.display_name).toBeNull()
    expect(calls.at(-1)?.payload.text).toContain('буквами')
  })
})

describe('отметки', () => {
  async function ready() {
    const h = await harness()
    await h.bot.handleUpdate(message('/start'))
    await h.bot.handleUpdate(message('Айгуль Смагулова'))
    const g = await createGroup(h.db, 'Утро')
    const check = await createTracker(h.db, { title: 'Зарядка', kind: 'check' })
    const pages = await createTracker(h.db, {
      title: 'Страницы', kind: 'number', target: 10, unit: 'стр.',
      description: 'читаем про психологию',
    })
    await setGroupTracker(h.db, g.id, check.id, true)
    await setGroupTracker(h.db, g.id, pages.id, true)
    await setMembership(h.db, 7, g.id, true)
    h.calls.length = 0
    return { ...h, check, pages }
  }

  it('тап по галочке отмечает и перерисовывает меню', async () => {
    const { bot, calls, check } = await ready()
    await bot.handleUpdate(tap(`t:${check.id}`))

    const answer = calls.find((c) => c.method === 'answerCallbackQuery')
    expect(answer?.payload.text).toBe('Отмечено ✅')
    const edit = calls.find((c) => c.method === 'editMessageText')
    expect(JSON.stringify(edit?.payload.reply_markup)).toContain('✅ Зарядка')
  })

  it('тап по числовому просит число, следующее сообщение записывается', async () => {
    const { db, bot, calls, pages } = await ready()
    await bot.handleUpdate(tap(`t:${pages.id}`))
    expect(calls.at(-1)?.payload.text).toContain('число')
    expect(calls.at(-1)?.payload.reply_markup).toEqual({ force_reply: true })

    await bot.handleUpdate(message('12'))
    const [row] = await db.q(`select value::float8 as value from entries where tracker_id = $1`, [pages.id])
    expect(row.value).toBe(12)
    expect(calls.some((c) => String(c.payload.text ?? '').includes('Записано'))).toBe(true)
  })

  it('мусор вместо числа не сбрасывает ожидание', async () => {
    const { db, bot, calls, pages } = await ready()
    await bot.handleUpdate(tap(`t:${pages.id}`))
    await bot.handleUpdate(message('много'))
    expect(calls.at(-1)?.payload.text).toContain('Нужно число')

    await bot.handleUpdate(message('7'))
    const [row] = await db.q(`select value::float8 as value from entries where tracker_id = $1`, [pages.id])
    expect(row.value).toBe(7)
  })

  it('запрос числа объясняет, о чём трекер', async () => {
    const { bot, calls, pages } = await ready()
    await bot.handleUpdate(tap(`t:${pages.id}`))
    const prompt = String(calls.at(-1)?.payload.text)
    expect(prompt).toContain('читаем про психологию')
    expect(prompt).toContain('цель 10 стр.')
  })

  it('экран «ℹ️ Трекеры» показывает описания', async () => {
    const { bot, calls } = await ready()
    await bot.handleUpdate(tap('s:info'))
    const text = String(calls.find((c) => c.method === 'editMessageText')?.payload.text)
    expect(text).toContain('Страницы — читаем про психологию')
    expect(text).toContain('Зарядка')
  })

  it('статистика открывается кнопкой', async () => {
    const { bot, calls } = await ready()
    await bot.handleUpdate(tap('s:me'))
    expect(String(calls.find((c) => c.method === 'editMessageText')?.payload.text)).toContain('<pre>')
  })

  it('повторный тап по галочке снимает отметку', async () => {
    const { db, bot, calls, check } = await ready()
    await bot.handleUpdate(tap(`t:${check.id}`))
    await bot.handleUpdate(tap(`t:${check.id}`))

    const rows = await db.q(`select 1 from entries where tracker_id = $1`, [check.id])
    expect(rows.length).toBe(0)

    const answer = calls.filter((c) => c.method === 'answerCallbackQuery').at(-1)
    expect(answer?.payload.text).toBe('Снято')
    const edit = calls.filter((c) => c.method === 'editMessageText').at(-1)
    expect(JSON.stringify(edit?.payload.reply_markup)).toContain('⬜️ Зарядка')
  })

  it('тап по трекеру, который перестал быть активным', async () => {
    const { db, bot, calls, check } = await ready()
    await archiveTracker(db, check.id)
    await bot.handleUpdate(tap(`t:${check.id}`))

    const answer = calls.find((c) => c.method === 'answerCallbackQuery')
    expect(answer?.payload.text).toBe('Трекер больше не активен')
    expect(calls.some((c) => c.method === 'editMessageText')).toBe(true)
    const rows = await db.q(`select 1 from entries where tracker_id = $1`, [check.id])
    expect(rows.length).toBe(0)
  })

  it('трекер архивируют между вопросом о числе и ответом — значение не пишется', async () => {
    const { db, bot, calls, pages } = await ready()
    await bot.handleUpdate(tap(`t:${pages.id}`))
    await archiveTracker(db, pages.id)
    await bot.handleUpdate(message('5'))

    expect(calls.some((c) => String(c.payload.text ?? '').includes('Трекер больше не активен'))).toBe(true)
    const rows = await db.q(`select 1 from entries where tracker_id = $1`, [pages.id])
    expect(rows.length).toBe(0)
  })

  it('0 снимает отметку по числовому трекеру', async () => {
    const { db, bot, calls, pages } = await ready()
    await bot.handleUpdate(tap(`t:${pages.id}`))
    await bot.handleUpdate(message('12'))
    let rows = await db.q(`select value::float8 as value from entries where tracker_id = $1`, [pages.id])
    expect(rows[0]?.value).toBe(12)

    await bot.handleUpdate(tap(`t:${pages.id}`))
    await bot.handleUpdate(message('0'))
    rows = await db.q(`select 1 from entries where tracker_id = $1`, [pages.id])
    expect(rows.length).toBe(0)
    expect(calls.some((c) => String(c.payload.text ?? '').includes('снята'))).toBe(true)
  })

  it('/name меняет имя, а при заблокированном имени — отказывает', async () => {
    const { db, bot, calls } = await ready()
    await bot.handleUpdate(message('/name Иван Петров'))
    expect((await getUser(db, 7))?.display_name).toBe('Иван Петров')
    expect(calls.at(-1)?.payload.text).toContain('Иван Петров')

    await setDisplayName(db, 7, 'Админское Имя', { byAdmin: true })
    calls.length = 0
    await bot.handleUpdate(message('/name Другое Имя'))
    expect((await getUser(db, 7))?.display_name).toBe('Админское Имя')
    expect(calls.at(-1)?.payload.text).toContain('администратор')
  })
})

describe('групповая сводка', () => {
  it('без групп — сообщение об этом', async () => {
    const { bot, calls } = await harness()
    await bot.handleUpdate(message('/start'))
    await bot.handleUpdate(message('Айгуль Смагулова'))
    calls.length = 0

    await bot.handleUpdate(tap('s:g'))
    const text = String(calls.find((c) => c.method === 'editMessageText')?.payload.text)
    expect(text).toBe('Вы пока не состоите ни в одной группе.')
  })

  it('в одной группе — сводка с «Вы» и процентами', async () => {
    const h = await harness()
    await h.bot.handleUpdate(message('/start'))
    await h.bot.handleUpdate(message('Айгуль Смагулова'))
    const g = await createGroup(h.db, 'Утро')
    const check = await createTracker(h.db, { title: 'Зарядка', kind: 'check' })
    await setGroupTracker(h.db, g.id, check.id, true)
    await setMembership(h.db, 7, g.id, true)
    await upsertFromTelegram(h.db, { id: 8, username: 'ivan', first_name: 'Иван' })
    await setMembership(h.db, 8, g.id, true)
    h.calls.length = 0

    await h.bot.handleUpdate(tap('s:g'))
    const text = String(h.calls.find((c) => c.method === 'editMessageText')?.payload.text)
    expect(text).toContain('Вы')
    expect(text).toMatch(/\d+%/)
  })
})

describe('сообщения в группе', () => {
  it('обычный текст (например, ответ на воскресный отчёт) в чате группы игнорируется', async () => {
    const { db, bot, calls } = await harness()

    const groupText: Update = {
      update_id: 1,
      message: {
        message_id: 1, date: 0, text: 'Айгуль Смагулова',
        chat: { id: -100500, type: 'supergroup' as const, title: 'Утро' },
        from: { id: 777, is_bot: false, first_name: 'Случайный' },
      },
    } as Update

    await bot.handleUpdate(groupText)

    // Ни ответа, ни регистрации участника, ни уведомления админам.
    expect(calls).toHaveLength(0)
    expect(await getUser(db, 777)).toBeNull()
  })
})

describe('неизвестный callback_data', () => {
  it('закрывает спиннер ответом без текста', async () => {
    const { bot, calls } = await harness()
    await bot.handleUpdate(message('/start'))
    await bot.handleUpdate(message('Айгуль Смагулова'))
    calls.length = 0

    await bot.handleUpdate(tap('legacy:unknown'))
    const answer = calls.find((c) => c.method === 'answerCallbackQuery')
    expect(answer).toBeTruthy()
  })
})
