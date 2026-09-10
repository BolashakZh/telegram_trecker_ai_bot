import { describe, expect, it } from 'vitest'
import { createGroup, setMembership } from '../lib/groups.ts'
import {
  activeTrackersForUser, archiveTracker, createTracker, listTrackers, setGroupTracker,
} from '../lib/trackers.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { testDb } from './helpers.ts'

describe('activeTrackersForUser', () => {
  it('трекер в двух группах человека показан один раз', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'А' })
    const morning = await createGroup(db, 'Утро')
    const sport = await createGroup(db, 'Спорт')
    const reading = await createTracker(db, { title: 'Чтение', kind: 'check' })

    await setGroupTracker(db, morning.id, reading.id, true)
    await setGroupTracker(db, sport.id, reading.id, true)
    await setMembership(db, 7, morning.id, true)
    await setMembership(db, 7, sport.id, true)

    const list = await activeTrackersForUser(db, 7)
    expect(list.map((t) => t.title)).toEqual(['Чтение'])
  })

  it('не показывает архивные трекеры и трекеры чужих групп', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'А' })
    const mine = await createGroup(db, 'Моя')
    const alien = await createGroup(db, 'Чужая')
    const live = await createTracker(db, { title: 'Зарядка', kind: 'check' })
    const dead = await createTracker(db, { title: 'Старое', kind: 'check' })
    const alienTracker = await createTracker(db, { title: 'Чужое', kind: 'check' })

    await setGroupTracker(db, mine.id, live.id, true)
    await setGroupTracker(db, mine.id, dead.id, true)
    await setGroupTracker(db, alien.id, alienTracker.id, true)
    await setMembership(db, 7, mine.id, true)
    await archiveTracker(db, dead.id)

    expect((await activeTrackersForUser(db, 7)).map((t) => t.title)).toEqual(['Зарядка'])
  })

  it('числовой трекер отдаёт цель числом, а не строкой', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7 })
    const g = await createGroup(db, 'Утро')
    const pages = await createTracker(db, { title: 'Страницы', kind: 'number', target: 10, unit: 'стр.' })
    await setGroupTracker(db, g.id, pages.id, true)
    await setMembership(db, 7, g.id, true)

    const [t] = await activeTrackersForUser(db, 7)
    expect(t.target).toBe(10)
    expect(typeof t.target).toBe('number')
    expect(t.unit).toBe('стр.')
  })
})

describe('listTrackers', () => {
  it('показывает, в каких группах используется трекер', async () => {
    const db = await testDb()
    const a = await createGroup(db, 'A')
    const b = await createGroup(db, 'B')
    const reading = await createTracker(db, { title: 'Чтение', kind: 'check' })
    await setGroupTracker(db, a.id, reading.id, true)
    await setGroupTracker(db, b.id, reading.id, true)

    const [row] = await listTrackers(db)
    expect(row.group_ids).toEqual([a.id, b.id])
  })
})
