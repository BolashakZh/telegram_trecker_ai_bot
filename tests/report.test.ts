import { describe, expect, it } from 'vitest'
import { toggleCheck } from '../lib/entries.ts'
import { bindChat, createGroup, setMembership } from '../lib/groups.ts'
import { claimSend, sendReminders, sendWeekly, weeklyText } from '../lib/report.ts'
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
  const sent: { chatId: number; text: string }[] = []
  return {
    sent,
    sender: { send: async (chatId: number, text: string) => { sent.push({ chatId, text }) } },
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

describe('weeklyText', () => {
  it('содержит проценты участников и итог по группе', async () => {
    const { db, g, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, '2026-09-08')
    const text = weeklyText(await groupReport(db, g.id, '2026-09-07', TODAY))
    expect(text).toContain('Айгуль')
    expect(text).toContain('Группа в среднем')
  })
})
