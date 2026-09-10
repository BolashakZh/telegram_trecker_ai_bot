import { describe, expect, it } from 'vitest'
import { dayAt, migrate, today } from '../lib/db.ts'
import { testDb } from './helpers.ts'

describe('migrate', () => {
  it('создаёт все таблицы и повторный вызов не падает', async () => {
    const db = await testDb()
    await migrate(db)

    const rows = await db.q(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    )
    expect(rows.map((r) => r.table_name)).toEqual([
      'entries', 'group_trackers', 'groups', 'memberships',
      'pending_input', 'processed', 'sent_log', 'trackers', 'users',
    ])
  })

  it('добавляет колонку description в уже созданную таблицу trackers', async () => {
    const db = await testDb()
    await db.q(`alter table trackers drop column description`)
    await migrate(db)

    const rows = await db.q(
      `select column_name from information_schema.columns
       where table_name = 'trackers' and column_name = 'description'`,
    )
    expect(rows).toHaveLength(1)
  })
})

describe('today / dayAt', () => {
  it('возвращает дату в часовом поясе базы данных', async () => {
    const db = await testDb('Asia/Almaty')
    // 2026-09-10 19:30 UTC = 2026-09-11 00:30 в Алматы (UTC+5)
    expect(await dayAt(db, '2026-09-10T19:30:00Z')).toBe('2026-09-11')
    expect(await dayAt(db, '2026-09-10T18:30:00Z')).toBe('2026-09-10')
  })

  it('today отдаёт строку YYYY-MM-DD', async () => {
    const db = await testDb()
    expect(await today(db)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
