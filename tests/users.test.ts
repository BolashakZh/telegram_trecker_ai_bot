import { describe, expect, it } from 'vitest'
import { getUser, normalizeName, setDisplayName, unlockName, upsertFromTelegram } from '../lib/users.ts'
import { personName } from '../lib/text.ts'
import { testDb } from './helpers.ts'

describe('normalizeName', () => {
  it('чистит пробелы и принимает нормальное имя', () => {
    expect(normalizeName('  Айгуль   Смагулова ')).toBe('Айгуль Смагулова')
  })

  it('отвергает мусор', () => {
    expect(normalizeName('a')).toBeNull()
    expect(normalizeName('   ')).toBeNull()
    expect(normalizeName('123')).toBeNull()
    expect(normalizeName('🙂🙂')).toBeNull()
    expect(normalizeName('x'.repeat(41))).toBeNull()
  })
})

describe('upsertFromTelegram', () => {
  it('создаёт человека без имени и обновляет данные Telegram при следующем апдейте', async () => {
    const db = await testDb()
    const first = await upsertFromTelegram(db, { id: 7, username: 'spider', first_name: 'Человек-паук' })
    expect(first.display_name).toBeNull()

    const second = await upsertFromTelegram(db, { id: 7, username: 'newnick', first_name: 'Человек-паук' })
    expect(second.username).toBe('newnick')
    expect(second.display_name).toBeNull()
  })
})

describe('setDisplayName', () => {
  it('участник задаёт имя сам', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Ч' })
    const res = await setDisplayName(db, 7, 'Айгуль Смагулова', { byAdmin: false })
    expect(res).toEqual({ ok: true, name: 'Айгуль Смагулова' })
    expect((await getUser(db, 7))?.display_name).toBe('Айгуль Смагулова')
  })

  it('правка админом блокирует самостоятельную смену, unlockName снимает замок', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Ч' })
    await setDisplayName(db, 7, 'Данияр Ахметов', { byAdmin: true })
    expect((await getUser(db, 7))?.name_locked).toBe(true)

    expect(await setDisplayName(db, 7, 'Человек-паук', { byAdmin: false })).toEqual({
      ok: false, reason: 'locked',
    })
    expect((await getUser(db, 7))?.display_name).toBe('Данияр Ахметов')

    await unlockName(db, 7)
    expect(await setDisplayName(db, 7, 'Данияр А', { byAdmin: false })).toEqual({
      ok: true, name: 'Данияр А',
    })
  })

  it('невалидное имя не записывается', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7 })
    expect(await setDisplayName(db, 7, '!!', { byAdmin: false })).toEqual({
      ok: false, reason: 'invalid',
    })
  })
})

describe('personName', () => {
  it('падает по цепочке display_name → first_name → @username → id', () => {
    expect(personName({ id: 7, display_name: 'Айгуль' })).toBe('Айгуль')
    expect(personName({ id: 7, first_name: 'Айгуль', display_name: null })).toBe('Айгуль')
    expect(personName({ id: 7, username: 'aigul', display_name: null, first_name: null })).toBe('@aigul')
    expect(personName({ id: 7 })).toBe('id 7')
  })
})
