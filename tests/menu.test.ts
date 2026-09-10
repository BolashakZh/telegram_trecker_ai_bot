import { describe, expect, it } from 'vitest'
import { infoScreen, mainScreen, statsScreen } from '../lib/menu.ts'
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
