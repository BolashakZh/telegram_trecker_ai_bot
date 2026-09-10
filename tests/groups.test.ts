import { describe, expect, it } from 'vitest'
import { bindChat, createGroup, groupMembers, listGroups, setMembership, userGroups } from '../lib/groups.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { testDb } from './helpers.ts'

describe('membership', () => {
  it('включается и выключается, повторный вызов идемпотентен', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Айгуль' })
    const g = await createGroup(db, 'Утро')

    await setMembership(db, 7, g.id, true)
    await setMembership(db, 7, g.id, true)
    expect((await userGroups(db, 7)).map((x) => x.title)).toEqual(['Утро'])
    expect((await groupMembers(db, g.id)).map((u) => u.id)).toEqual([7])

    await setMembership(db, 7, g.id, false)
    expect(await userGroups(db, 7)).toEqual([])
  })
})

describe('bindChat', () => {
  it('привязывает чат и переносит его с другой группы', async () => {
    const db = await testDb()
    const a = await createGroup(db, 'A')
    const b = await createGroup(db, 'B')

    await bindChat(db, a.id, -100500)
    await bindChat(db, b.id, -100500)

    const groups = await listGroups(db)
    expect(groups.find((g) => g.id === a.id)?.chat_id).toBeNull()
    expect(groups.find((g) => g.id === b.id)?.chat_id).toBe(-100500)
  })
})
