import { describe, expect, it } from 'vitest'
import { createGroup, setMembership } from '../lib/groups.ts'
import { createTracker, setGroupTracker } from '../lib/trackers.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { toggleCheck } from '../lib/entries.ts'
import { groupReport, missingToday, usersWithUnfinished } from '../lib/group-stats.ts'
import { testDb } from './helpers.ts'

const FROM = '2026-09-07'
const TODAY = '2026-09-10'

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

describe('groupReport', () => {
  it('считает процент участника от ожидаемых дней периода', async () => {
    const { db, g, charge } = await fixture()
    for (const d of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']) {
      await toggleCheck(db, 1, charge.id, d)
    }
    await toggleCheck(db, 2, charge.id, '2026-09-07')

    const rep = await groupReport(db, g.id, FROM, TODAY)
    const aigul = rep.members.find((m) => m.user_id === 1)!
    const daniyar = rep.members.find((m) => m.user_id === 2)!

    expect(aigul).toMatchObject({ done: 4, expected: 4, percent: 100 })
    expect(daniyar).toMatchObject({ done: 1, expected: 4, percent: 25 })
    expect(rep.percent).toBe(63) // среднее по участникам, округление к ближайшему
    expect(rep.trackers[0]).toMatchObject({ title: 'Зарядка', percent: 63 })
  })

  it('участник, добавленный позже, не получает нули за прошедшие дни', async () => {
    const { db, g, charge } = await fixture()
    await db.q(`update memberships set joined_at = '2026-09-10T06:00:00Z' where user_id = 2`)
    await toggleCheck(db, 2, charge.id, TODAY)

    const rep = await groupReport(db, g.id, FROM, TODAY)
    expect(rep.members.find((m) => m.user_id === 2)).toMatchObject({
      done: 1, expected: 1, percent: 100,
    })
  })

  it('карта дней отдаёт по ячейке на участника и день периода', async () => {
    const { db, g, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, '2026-09-08')

    const rep = await groupReport(db, g.id, FROM, TODAY)
    expect(rep.days.filter((d) => d.user_id === 1)).toHaveLength(4)
    expect(rep.days.find((d) => d.user_id === 1 && d.day === '2026-09-08')?.percent).toBe(100)
    expect(rep.days.find((d) => d.user_id === 1 && d.day === '2026-09-07')?.percent).toBe(0)
  })

  it('дата вступления приводится к таймзоне проекта (Asia/Almaty), а не к сессии Postgres (UTC)', async () => {
    // Сессия тестовой БД принудительно в UTC (см. tests/helpers.ts). 20:00 UTC —
    // это уже 11 сентября по Алматы. Наивный ::date-каст в сессионной таймзоне
    // (UTC) дал бы 10 сентября — лишний ожидаемый день и заниженный процент.
    const { db, g, charge } = await fixture()
    await db.q(`update memberships set joined_at = '2026-09-10T20:00:00Z' where user_id = 2`)
    await toggleCheck(db, 2, charge.id, '2026-09-11')

    const rep = await groupReport(db, g.id, '2026-09-07', '2026-09-11')
    const daniyar = rep.members.find((m) => m.user_id === 2)!
    expect(daniyar).toMatchObject({ done: 1, expected: 1, percent: 100 })
  })
})

describe('missingToday', () => {
  it('перечисляет, кто и какие трекеры не закрыл сегодня', async () => {
    const { db, g, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, TODAY)

    const missing = await missingToday(db, g.id, TODAY)
    expect(missing).toEqual([{ user_id: 2, name: 'Данияр', titles: ['Зарядка'] }])
  })
})

describe('usersWithUnfinished', () => {
  it('возвращает только тех, у кого остались незакрытые трекеры', async () => {
    const { db, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, TODAY)

    expect(await usersWithUnfinished(db, TODAY)).toEqual([{ user_id: 2, count: 1 }])
  })
})
