import { describe, expect, it } from 'vitest'
import { bar, clip, formatDay, formatRange, num, padRight } from '../lib/text.ts'

describe('bar', () => {
  it('рисует заполнение по проценту', () => {
    expect(bar(0, 5)).toBe('▱▱▱▱▱')
    expect(bar(100, 5)).toBe('▰▰▰▰▰')
    expect(bar(43, 7)).toBe('▰▰▰▱▱▱▱')
  })
})

describe('formatDay / formatRange', () => {
  it('пишет дату по-казахски', () => {
    expect(formatDay('2026-09-10')).toBe('бейсенбі, 10 қыркүйек')
    expect(formatRange('2026-09-07', '2026-09-13')).toBe('7–13 қыркүйек')
    expect(formatRange('2026-08-31', '2026-09-06')).toBe('31 тамыз – 6 қыркүйек')
  })
})

describe('num', () => {
  it('убирает хвостовые нули', () => {
    expect(num(12)).toBe('12')
    expect(num(12.5)).toBe('12,5')
    expect(num(12.0)).toBe('12')
  })
})

describe('clip', () => {
  it('режет длинный текст по строкам и дописывает хвост', () => {
    const text = Array.from({ length: 500 }, (_, i) => `строка номер ${i}`).join('\n')
    const out = clip(text, 200)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out).toMatch(/…тағы \d+ жол/)
  })

  it('короткий текст не трогает', () => {
    expect(clip('привет', 100)).toBe('привет')
  })
})

describe('padRight', () => {
  it('дополняет до ширины и не обрезает длиннее', () => {
    expect(padRight('Айгуль', 10)).toBe('Айгуль    ')
    expect(padRight('Айгуль', 3)).toBe('Айгуль')
  })
})
