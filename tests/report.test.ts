import { describe, expect, it } from 'vitest'
import type { InlineKeyboardMarkup } from 'grammy/types'
import { toggleCheck } from '../lib/entries.ts'
import { bindChat, createGroup, setMembership } from '../lib/groups.ts'
import { claimSend, sendAccessGranted, sendReminders, sendWeekly, weeklyText } from '../lib/report.ts'
import { createTracker, setGroupTracker } from '../lib/trackers.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { groupReport } from '../lib/group-stats.ts'
import { testDb } from './helpers.ts'

const TODAY = '2026-09-13' // воскресенье

async function fixture() {
  const db = await testDb()
  await upsertFromTelegram(db, { id: 1, first_name: 'Айгуль' })
  await upsertFromTelegram(db, { id: 2, first_name: 'Данияр' })
  const g = await createGroup(db, 'Утро')
  const charge = await createTracker(db, { title: 'Зарядка', kind: 'check' })
  await setGroupTracker(db, g.id, charge.id, true)
  await setMembership(db, 1, g.id, true)
  await setMembership(db, 2, g.id, true)
  await db.q(`update memberships set joined_at = '2026-09-01T00:00:00Z'`)
  await db.q(`update group_trackers set linked_at = '2026-09-01T00:00:00Z'`)
  await db.q(`update trackers set created_at = '2026-01-01T00:00:00Z'`)
  return { db, g, charge }
}

function recorder() {
  const sent: { chatId: number; text: string; keyboard?: InlineKeyboardMarkup }[] = []
  return {
    sent,
    sender: {
      send: async (chatId: number, text: string, keyboard?: InlineKeyboardMarkup) => {
        sent.push({ chatId, text, keyboard })
      },
    },
  }
}

describe('claimSend', () => {
  it('пропускает первый вызов и блокирует повтор', async () => {
    const { db } = await fixture()
    expect(await claimSend(db, 'weekly', '2026-09-07:1')).toBe(true)
    expect(await claimSend(db, 'weekly', '2026-09-07:1')).toBe(false)
  })
})

describe('sendReminders', () => {
  it('пишет только тем, у кого остались незакрытые трекеры', async () => {
    const { db, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, TODAY)
    const { sent, sender } = recorder()

    expect(await sendReminders(db, sender, TODAY)).toBe(1)
    expect(sent.map((s) => s.chatId)).toEqual([2])
    expect(sent[0].text).toContain('Осталось на сегодня')
  })

  it('повторный запуск в тот же день не шлёт второе сообщение', async () => {
    const { db } = await fixture()
    const { sent, sender } = recorder()
    await sendReminders(db, sender, TODAY)
    await sendReminders(db, sender, TODAY)
    expect(sent.filter((s) => s.chatId === 2)).toHaveLength(1)
  })

  it('падение отправки одному не мешает остальным', async () => {
    const { db } = await fixture()
    const sent: number[] = []
    const sender = {
      send: async (chatId: number) => {
        if (chatId === 1) throw new Error('bot was blocked by the user')
        sent.push(chatId)
      },
    }
    expect(await sendReminders(db, sender, TODAY)).toBe(1)
    expect(sent).toEqual([2])
  })
})

describe('sendWeekly', () => {
  it('шлёт отчёт в чат группы и не повторяется', async () => {
    const { db, g, charge } = await fixture()
    await bindChat(db, g.id, -100500)
    await toggleCheck(db, 1, charge.id, '2026-09-08')
    const { sent, sender } = recorder()

    expect(await sendWeekly(db, sender, TODAY)).toBe(1)
    expect(sent[0].chatId).toBe(-100500)
    expect(sent[0].text).toContain('итоги недели')
    expect(await sendWeekly(db, sender, TODAY)).toBe(0)
  })

  it('группу без чата пропускает', async () => {
    const { db } = await fixture()
    const { sent, sender } = recorder()
    expect(await sendWeekly(db, sender, TODAY)).toBe(0)
    expect(sent).toEqual([])
  })
})

describe('sendAccessGranted', () => {
  it('шлёт сообщение с названием группы и клавиатурой главного экрана', async () => {
    const { db } = await fixture()
    const { sent, sender } = recorder()

    await sendAccessGranted(db, sender, 1, 'Утро')

    expect(sent).toHaveLength(1)
    expect(sent[0].chatId).toBe(1)
    expect(sent[0].text).toContain('Утро')
    expect(sent[0].keyboard?.inline_keyboard.flat().map((b) => b.text)).toContain('⬜️ Зарядка')
  })
})

describe('weeklyText', () => {
  it('содержит проценты участников и итог по группе', async () => {
    const { db, g, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, '2026-09-08')
    const text = weeklyText(await groupReport(db, g.id, '2026-09-07', TODAY))
    expect(text).toContain('Айгуль')
    expect(text).toContain('Группа в среднем')
  })

  it('экранирует HTML в названии группы и именах участников', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 1, first_name: 'Вася <b>крутой</b>' })
    const g = await createGroup(db, 'Утро <script>')
    const charge = await createTracker(db, { title: 'Медитация < 10', kind: 'check' })
    await setGroupTracker(db, g.id, charge.id, true)
    await setMembership(db, 1, g.id, true)
    await db.q(`update memberships set joined_at = '2026-09-01T00:00:00Z'`)
    await db.q(`update group_trackers set linked_at = '2026-09-01T00:00:00Z'`)
    await db.q(`update trackers set created_at = '2026-01-01T00:00:00Z'`)

    const text = weeklyText(await groupReport(db, g.id, '2026-09-07', TODAY))
    expect(text).not.toContain('<script>')
    expect(text).not.toContain('<b>крутой</b>')
    expect(text).not.toContain('< 10')
    expect(text).toContain('Утро &lt;script&gt;')
    expect(text).toContain('Вася &lt;b&gt;крутой&lt;/b&gt;')
    expect(text).toContain('Медитация &lt; 10')
  })

  it('режет длинный список участников по лимиту 4096, сохраняя парные теги <pre>', async () => {
    const db = await testDb()
    const g = await createGroup(db, 'Большая группа')
    const charge = await createTracker(db, { title: 'Зарядка', kind: 'check' })
    await setGroupTracker(db, g.id, charge.id, true)
    for (let i = 1; i <= 300; i += 1) {
      await upsertFromTelegram(db, { id: i, first_name: `Участник номер ${i}` })
      await setMembership(db, i, g.id, true)
    }
    await db.q(`update memberships set joined_at = '2026-09-01T00:00:00Z'`)
    await db.q(`update group_trackers set linked_at = '2026-09-01T00:00:00Z'`)
    await db.q(`update trackers set created_at = '2026-01-01T00:00:00Z'`)

    const text = weeklyText(await groupReport(db, g.id, '2026-09-07', TODAY))
    expect(text.length).toBeLessThanOrEqual(4096)
    expect(text.split('<pre>')).toHaveLength(2)
    expect(text.split('</pre>')).toHaveLength(2)
    expect(text.indexOf('<pre>')).toBeLessThan(text.indexOf('</pre>'))
  })
})
