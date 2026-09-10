import { describe, expect, it } from 'vitest'
import { BadRequest, flag, id, title, trackerInput } from '../lib/validate.ts'

describe('validate', () => {
  it('flag принимает только boolean', () => {
    expect(flag(true)).toBe(true)
    expect(flag(false)).toBe(false)
    expect(() => flag('true')).toThrow(BadRequest)
    expect(() => flag(1)).toThrow(BadRequest)
    expect(() => flag(undefined)).toThrow(BadRequest)
  })

  it('title чистит и проверяет длину', () => {
    expect(title('  Утро  ')).toBe('Утро')
    expect(() => title('')).toThrow(BadRequest)
    expect(() => title('x'.repeat(61))).toThrow(BadRequest)
  })

  it('id принимает только положительные целые', () => {
    expect(id(5)).toBe(5)
    expect(id('5')).toBe(5)
    expect(() => id(0)).toThrow(BadRequest)
    expect(() => id('abc')).toThrow(BadRequest)
  })

  it('trackerInput требует цель и единицу у числового', () => {
    expect(trackerInput({ title: 'Зарядка', kind: 'check' })).toEqual({
      title: 'Зарядка', kind: 'check', target: 1, unit: null, description: null,
    })
    expect(trackerInput({ title: 'Страницы', kind: 'number', target: 10, unit: 'стр.' })).toEqual({
      title: 'Страницы', kind: 'number', target: 10, unit: 'стр.', description: null,
    })
    expect(() => trackerInput({ title: 'Страницы', kind: 'number', target: 0, unit: 'стр.' })).toThrow(BadRequest)
    expect(() => trackerInput({ title: 'Страницы', kind: 'number', target: 10 })).toThrow(BadRequest)
    expect(() => trackerInput({ title: 'X', kind: 'weird' })).toThrow(BadRequest)
  })

  it('trackerInput принимает описание и режет слишком длинное', () => {
    expect(trackerInput({ title: 'Книга', kind: 'check', description: '  читаем  про психологию ' }))
      .toEqual({ title: 'Книга', kind: 'check', target: 1, unit: null, description: 'читаем про психологию' })
    expect(trackerInput({ title: 'Книга', kind: 'check', description: '   ' }).description).toBeNull()
    expect(() => trackerInput({ title: 'Книга', kind: 'check', description: 'x'.repeat(201) }))
      .toThrow(BadRequest)
  })
})
