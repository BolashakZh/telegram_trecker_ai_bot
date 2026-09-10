import { describe, expect, it } from 'vitest'
import { createGroup, setMembership } from '../lib/groups.ts'
import { createTracker, setGroupTracker } from '../lib/trackers.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import {
  claimUpdate, clearPending, dayState, parseNumber, setPending, setValue, takePending, toggleCheck,
} from '../lib/entries.ts'
import { testDb } from './helpers.ts'

const DAY = '2026-09-10'

async function fixture() {
  const db = await testDb()
  await upsertFromTelegram(db, { id: 7, first_name: 'А' })
  const g = await createGroup(db, 'Утро')
  const check = await createTracker(db, { title: 'Зарядка', kind: 'check' })
  const pages = await createTracker(db, { title: 'Страницы', kind: 'number', target: 10, unit: 'стр.' })
  await setGroupTracker(db, g.id, check.id, true)
  await setGroupTracker(db, g.id, pages.id, true)
  await setMembership(db, 7, g.id, true)
  return { db, g, check, pages }
}

describe('toggleCheck', () => {
  it('два тапа возвращают исходное состояние', async () => {
    const { db, check } = await fixture()
    expect(await toggleCheck(db, 7, check.id, DAY)).toEqual({ done: true })
    expect(await toggleCheck(db, 7, check.id, DAY)).toEqual({ done: false })
    expect((await dayState(db, 7, DAY)).size).toBe(0)
  })
})

describe('setValue', () => {
  it('значение ниже цели записывается, но выполнением не считается', async () => {
    const { db, pages } = await fixture()
    expect(await setValue(db, 7, pages.id, DAY, 4)).toEqual({ done: false, cleared: false })
    expect((await dayState(db, 7, DAY)).get(pages.id)).toEqual({
      tracker_id: pages.id, value: 4, done: false,
    })
  })

  it('значение с цели и выше — выполнение; повторная запись перезаписывает', async () => {
    const { db, pages } = await fixture()
    await setValue(db, 7, pages.id, DAY, 4)
    expect(await setValue(db, 7, pages.id, DAY, 12.5)).toEqual({ done: true, cleared: false })
    expect((await dayState(db, 7, DAY)).get(pages.id)?.value).toBe(12.5)
  })

  it('ноль стирает отметку', async () => {
    const { db, pages } = await fixture()
    await setValue(db, 7, pages.id, DAY, 12)
    expect(await setValue(db, 7, pages.id, DAY, 0)).toEqual({ done: false, cleared: true })
    expect((await dayState(db, 7, DAY)).has(pages.id)).toBe(false)
  })

  it('значение ровно на границе цели — тоже выполнение', async () => {
    const { db, pages } = await fixture()
    expect(await setValue(db, 7, pages.id, DAY, 10)).toEqual({ done: true, cleared: false })
  })

  it('ноль дважды подряд не падает и оставляет состояние пустым', async () => {
    const { db, pages } = await fixture()
    expect(await setValue(db, 7, pages.id, DAY, 0)).toEqual({ done: false, cleared: true })
    expect(await setValue(db, 7, pages.id, DAY, 0)).toEqual({ done: false, cleared: true })
    expect((await dayState(db, 7, DAY)).has(pages.id)).toBe(false)
  })
})

describe('parseNumber', () => {
  it('принимает целые, дробные и запятую, отвергает мусор', () => {
    expect(parseNumber('12')).toBe(12)
    expect(parseNumber(' 12.5 ')).toBe(12.5)
    expect(parseNumber('12,5')).toBe(12.5)
    expect(parseNumber('0')).toBe(0)
    expect(parseNumber('-3')).toBeNull()
    expect(parseNumber('двенадцать')).toBeNull()
    expect(parseNumber('')).toBeNull()
  })
})

describe('claimUpdate', () => {
  it('первый раз true, повтор false', async () => {
    const { db } = await fixture()
    expect(await claimUpdate(db, 555)).toBe(true)
    expect(await claimUpdate(db, 555)).toBe(false)
  })
})

describe('pending_input', () => {
  it('хранит один трекер на человека и протухает', async () => {
    const { db, pages, check } = await fixture()
    await setPending(db, 7, pages.id)
    await setPending(db, 7, check.id)
    expect(await takePending(db, 7)).toBe(check.id)

    await setPending(db, 7, pages.id)
    await db.q(`update pending_input set at = now() - interval '16 minutes' where user_id = 7`)
    expect(await takePending(db, 7, 15)).toBeNull()

    await setPending(db, 7, pages.id)
    await clearPending(db, 7)
    expect(await takePending(db, 7)).toBeNull()
  })
})
