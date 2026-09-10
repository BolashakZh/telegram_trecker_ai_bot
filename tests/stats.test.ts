import { describe, expect, it } from 'vitest'
import { createGroup, setMembership } from '../lib/groups.ts'
import { createTracker, setGroupTracker } from '../lib/trackers.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { setValue, toggleCheck } from '../lib/entries.ts'
import { monthStart, userStats, weekStart } from '../lib/stats.ts'
import { testDb } from './helpers.ts'

// «Сегодня» в тестах — четверг.
const TODAY = '2026-09-10'

describe('weekStart / monthStart', () => {
  it('неделя начинается с понедельника', () => {
    expect(weekStart('2026-09-10')).toBe('2026-09-07') // чт → пн
    expect(weekStart('2026-09-07')).toBe('2026-09-07')
    expect(weekStart('2026-09-13')).toBe('2026-09-07') // вс → пн той же недели
    expect(monthStart('2026-09-10')).toBe('2026-09-01')
  })
})

async function fixture(opts: { joinedAt?: string; trackerCreatedAt?: string } = {}) {
  const db = await testDb()
  await upsertFromTelegram(db, { id: 7, first_name: 'А' })
  const g = await createGroup(db, 'Утро')
  const check = await createTracker(db, { title: 'Зарядка', kind: 'check' })
  await setGroupTracker(db, g.id, check.id, true)
  await setMembership(db, 7, g.id, true)

  if (opts.trackerCreatedAt) {
    await db.q(`update trackers set created_at = $1::timestamptz where id = $2`,
      [opts.trackerCreatedAt, check.id])
  }
  if (opts.joinedAt) {
    await db.q(`update memberships set joined_at = $1::timestamptz where user_id = 7`,
      [opts.joinedAt])
    await db.q(`update group_trackers set linked_at = $1::timestamptz`, [opts.joinedAt])
  }
  return { db, g, check }
}

describe('userStats', () => {
  it('считает неделю от даты вступления, а не от начала недели', async () => {
    // Человек в группе со среды: ожидаются ср, чт — два дня, а не семь.
    const { db, check } = await fixture({
      joinedAt: '2026-09-09T08:00:00Z', trackerCreatedAt: '2026-01-01T00:00:00Z',
    })
    await toggleCheck(db, 7, check.id, '2026-09-09')

    const [s] = await userStats(db, 7, TODAY)
    expect(s.start_day).toBe('2026-09-09')
    expect(s.expected_week).toBe(2)
    expect(s.done_week).toBe(1)
  })

  it('серия тянется до вчера и не рвётся отсутствием отметки сегодня', async () => {
    const { db, check } = await fixture({
      joinedAt: '2026-09-01T00:00:00Z', trackerCreatedAt: '2026-01-01T00:00:00Z',
    })
    for (const d of ['2026-09-07', '2026-09-08', '2026-09-09']) {
      await toggleCheck(db, 7, check.id, d)
    }

    const [s] = await userStats(db, 7, TODAY)
    expect(s.streak).toBe(3)
  })

  it('серия обнуляется, если последняя отметка позавчера', async () => {
    const { db, check } = await fixture({
      joinedAt: '2026-09-01T00:00:00Z', trackerCreatedAt: '2026-01-01T00:00:00Z',
    })
    await toggleCheck(db, 7, check.id, '2026-09-08')

    const [s] = await userStats(db, 7, TODAY)
    expect(s.streak).toBe(0)
  })

  it('пропуски считаются по вчера включительно', async () => {
    // В группе с 8-го, отмечено только 8-е: пропуск — 9-е. Сегодня (10-е) не в счёт.
    const { db, check } = await fixture({
      joinedAt: '2026-09-08T00:00:00Z', trackerCreatedAt: '2026-01-01T00:00:00Z',
    })
    await toggleCheck(db, 7, check.id, '2026-09-08')

    const [s] = await userStats(db, 7, TODAY)
    expect(s.misses).toBe(1)
  })

  it('числовой трекер: сумма за неделю и выполнение по цели', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7 })
    const g = await createGroup(db, 'Утро')
    const pages = await createTracker(db, { title: 'Страницы', kind: 'number', target: 10, unit: 'стр.' })
    await setGroupTracker(db, g.id, pages.id, true)
    await setMembership(db, 7, g.id, true)
    await db.q(`update memberships set joined_at = '2026-09-07T00:00:00Z'`)
    await db.q(`update group_trackers set linked_at = '2026-09-07T00:00:00Z'`)
    await db.q(`update trackers set created_at = '2026-01-01T00:00:00Z'`)

    await setValue(db, 7, pages.id, '2026-09-07', 12)
    await setValue(db, 7, pages.id, '2026-09-08', 4)

    const [s] = await userStats(db, 7, TODAY)
    expect(s.done_week).toBe(1)      // только 12 ≥ 10
    expect(s.sum_week).toBe(16)
    expect(s.expected_week).toBe(4)  // пн–чт
  })
})
