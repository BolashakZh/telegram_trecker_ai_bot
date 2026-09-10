import { describe, expect, it } from 'vitest'
import { bootstrap, groupsAction, statsQuery, trackersAction, usersAction } from '../lib/admin.ts'
import { toggleCheck } from '../lib/entries.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { BadRequest } from '../lib/validate.ts'
import { testDb } from './helpers.ts'

describe('bootstrap', () => {
  it('отдаёт группы, трекеры и людей одним куском', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Айгуль' })
    await groupsAction(db, { action: 'create', title: 'Утро' })

    const data = await bootstrap(db)
    expect(data.groups.map((g) => g.title)).toEqual(['Утро'])
    expect(data.users.map((u) => u.id)).toEqual([7])
    expect(data.users[0].group_ids).toEqual([])
  })
})

describe('usersAction', () => {
  it('назначает и снимает группу', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Айгуль' })
    const { groups } = await groupsAction(db, { action: 'create', title: 'Утро' })
    const gid = groups[0].id

    let users = await usersAction(db, { action: 'membership', userId: 7, groupId: gid, on: true })
    expect(users[0].group_ids).toEqual([gid])

    users = await usersAction(db, { action: 'membership', userId: 7, groupId: gid, on: false })
    expect(users[0].group_ids).toEqual([])
  })

  it('переименование админом ставит замок, unlockName снимает', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Ч' })

    let users = await usersAction(db, { action: 'rename', userId: 7, displayName: 'Данияр Ахметов' })
    expect(users[0]).toMatchObject({ display_name: 'Данияр Ахметов', name_locked: true })

    users = await usersAction(db, { action: 'unlockName', userId: 7 })
    expect(users[0].name_locked).toBe(false)
  })

  it('мусорное имя отвергается', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7 })
    await expect(usersAction(db, { action: 'rename', userId: 7, displayName: '!' }))
      .rejects.toBeInstanceOf(BadRequest)
  })
})

describe('trackersAction', () => {
  it('создаёт числовой трекер и привязывает его к группе', async () => {
    const db = await testDb()
    const { groups } = await groupsAction(db, { action: 'create', title: 'Утро' })
    const trackers = await trackersAction(db, {
      action: 'create', title: 'Страницы', kind: 'number', target: 10, unit: 'стр.',
    })
    expect(trackers[0]).toMatchObject({ title: 'Страницы', target: 10, unit: 'стр.' })

    const after = await groupsAction(db, {
      action: 'tracker', groupId: groups[0].id, trackerId: trackers[0].id, on: true,
    })
    expect(after.trackers[0].group_ids).toEqual([groups[0].id])
  })

  it('числовой трекер без единицы не создаётся', async () => {
    const db = await testDb()
    await expect(trackersAction(db, { action: 'create', title: 'Страницы', kind: 'number', target: 10 }))
      .rejects.toBeInstanceOf(BadRequest)
  })

  it('архивный трекер нельзя привязать к группе', async () => {
    const db = await testDb()
    const { groups } = await groupsAction(db, { action: 'create', title: 'Утро' })
    const trackers = await trackersAction(db, { action: 'create', title: 'Старое', kind: 'check' })
    await trackersAction(db, { action: 'archive', trackerId: trackers[0].id })

    await expect(groupsAction(db, {
      action: 'tracker', groupId: groups[0].id, trackerId: trackers[0].id, on: true,
    })).rejects.toBeInstanceOf(BadRequest)
  })
})

describe('statsQuery', () => {
  it('период week считает от понедельника', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Айгуль' })
    const { groups } = await groupsAction(db, { action: 'create', title: 'Утро' })
    const trackers = await trackersAction(db, { action: 'create', title: 'Зарядка', kind: 'check' })
    await groupsAction(db, {
      action: 'tracker', groupId: groups[0].id, trackerId: trackers[0].id, on: true,
    })
    await usersAction(db, { action: 'membership', userId: 7, groupId: groups[0].id, on: true })
    await db.q(`update memberships set joined_at = '2026-09-01T00:00:00Z'`)
    await db.q(`update group_trackers set linked_at = '2026-09-01T00:00:00Z'`)
    await db.q(`update trackers set created_at = '2026-01-01T00:00:00Z'`)
    await toggleCheck(db, 7, trackers[0].id, '2026-09-08')

    const rep = await statsQuery(db, { groupId: groups[0].id, period: 'week', today: '2026-09-10' })
    expect(rep.from).toBe('2026-09-07')
    expect(rep.members[0]).toMatchObject({ done: 1, expected: 4 })
  })
})
