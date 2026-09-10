import { describe, expect, it } from 'vitest'
import { groupScreen, groupsKeyboard, infoScreen, mainScreen, statsScreen } from '../lib/menu.ts'
import type { Group } from '../lib/groups.ts'
import type { GroupReport } from '../lib/group-stats.ts'
import type { Tracker } from '../lib/trackers.ts'

const check: Tracker = {
  id: 1, title: 'Зарядка', description: null,
  kind: 'check', target: 1, unit: null, archived_at: null,
}
const pages: Tracker = {
  id: 2, title: 'Страницы', description: 'читаем про психологию',
  kind: 'number', target: 10, unit: 'стр.', archived_at: null,
}

describe('mainScreen', () => {
  it('рисует галочки, числа и счётчик выполненного', () => {
    const state = new Map([
      [1, { tracker_id: 1, value: 1, done: true }],
      [2, { tracker_id: 2, value: 4, done: false }],
    ])
    const { text, keyboard } = mainScreen({ day: '2026-09-10', trackers: [check, pages], state })

    expect(text).toContain('четверг, 10 сентября')
    expect(text).toContain('Выполнено 1 из 2')
    const labels = keyboard.inline_keyboard.flat().map((b) => b.text)
    expect(labels).toContain('✅ Зарядка')
    expect(labels).toContain('⬜️ Страницы 4/10')
    expect(keyboard.inline_keyboard.flat().map((b) => (b as { callback_data: string }).callback_data))
      .toContain('t:2')
  })

  it('без трекеров показывает объяснение, а не пустой экран', () => {
    const { text, keyboard } = mainScreen({ day: '2026-09-10', trackers: [], state: new Map() })
    expect(text).toContain('Доступ пока не выдан')
    expect(keyboard.inline_keyboard).toEqual([])
  })
})

describe('infoScreen', () => {
  it('показывает описание, цель и единицу; трекер без описания — одним названием', () => {
    const text = infoScreen([check, pages])
    expect(text).toContain('Страницы — читаем про психологию')
    expect(text).toContain('цель 10 стр.')
    expect(text).toContain('Зарядка')
    expect(text).not.toContain('Зарядка —')
  })

  it('без трекеров объясняет, а не молчит', () => {
    expect(infoScreen([])).toContain('Пока нет трекеров')
  })

  it('числовой трекер без единицы не имеет лишний пробел', () => {
    const noUnit: Tracker = {
      id: 3, title: 'Подходы', description: null,
      kind: 'number', target: 5, unit: null, archived_at: null,
    }
    const text = infoScreen([noUnit])
    expect(text).toContain('Подходы')
    expect(text).toContain('цель 5)')
    expect(text).not.toMatch(/цель 5 \)/)
  })
})

describe('statsScreen', () => {
  it('для числового трекера добавляет строку с суммой', () => {
    const text = statsScreen([
      {
        tracker: pages, start_day: '2026-09-07',
        done_week: 3, expected_week: 7, done_month: 12, expected_month: 30,
        streak: 0, misses: 4, sum_week: 47,
      },
    ])
    expect(text).toContain('Страницы')
    expect(text).toContain('3/7')
    expect(text).toContain('47 стр.')
  })
})

describe('groupScreen', () => {
  it('показывает сводку с участниками, бары, проценты, и информацию о невыполненных', () => {
    const report: GroupReport = {
      group_id: 1,
      title: 'Друзья',
      from: '2026-09-07',
      to: '2026-09-13',
      members: [
        { user_id: 10, name: 'Айгуль', done: 7, expected: 7, percent: 100 },
        { user_id: 20, name: 'Марат', done: 5, expected: 7, percent: 71 },
        { user_id: 30, name: 'Юра', done: 3, expected: 7, percent: 43 },
      ],
      trackers: [],
      days: [],
      percent: 71,
    }
    const missing = [{ name: 'Юра', titles: ['Зарядка', 'Страницы'] }]
    const text = groupScreen(report, 10, missing)

    expect(text).toContain('Группа «Друзья»')
    expect(text).toContain('7–13 сентября')
    expect(text).toContain('Вы')
    expect(text).not.toContain('Айгуль')
    expect(text).toContain('Марат')
    expect(text).toContain('100%')
    expect(text).toContain('71%')
    expect(text).toContain('43%')
    expect(text).toContain('Сегодня не отметились')
    expect(text).toContain('Юра')
    expect(text).toContain('Зарядка, Страницы')
  })

  it('при пустом списке невыполненных показывает "Сегодня отметились все"', () => {
    const report: GroupReport = {
      group_id: 1,
      title: 'Тесты',
      from: '2026-09-07',
      to: '2026-09-13',
      members: [
        { user_id: 10, name: 'Айгуль', done: 7, expected: 7, percent: 100 },
        { user_id: 20, name: 'Марат', done: 7, expected: 7, percent: 100 },
      ],
      trackers: [],
      days: [],
      percent: 100,
    }
    const text = groupScreen(report, 10, [])

    expect(text).toContain('Сегодня отметились все')
    expect(text).not.toContain('Сегодня не отметились')
  })
})

describe('groupsKeyboard', () => {
  it('строит клавиатуру из списка групп с нужным префиксом', () => {
    const groups: Group[] = [
      { id: 1, title: 'Друзья', chat_id: null, archived_at: null },
      { id: 2, title: 'Семья', chat_id: null, archived_at: null },
    ]
    const keyboard = groupsKeyboard(groups, 'g:')

    expect(keyboard.inline_keyboard).toHaveLength(2)
    expect(keyboard.inline_keyboard[0]).toHaveLength(1)
    expect(keyboard.inline_keyboard[0][0].text).toBe('Друзья')
    expect((keyboard.inline_keyboard[0][0] as { callback_data: string }).callback_data).toBe('g:1')
    expect(keyboard.inline_keyboard[1][0].text).toBe('Семья')
    expect((keyboard.inline_keyboard[1][0] as { callback_data: string }).callback_data).toBe('g:2')
  })
})
