import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { requireAdmin, verifyInitData } from '../lib/auth.ts'

const TOKEN = '42:TESTTOKEN'

function signInitData(user: object, authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAA',
    user: JSON.stringify(user),
  })
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'))
  return params.toString()
}

const NOW = 1_800_000_000

describe('verifyInitData', () => {
  it('пропускает валидную подпись и возвращает пользователя', () => {
    const data = signInitData({ id: 99, first_name: 'Админ' }, NOW - 60)
    expect(verifyInitData(data, TOKEN, { now: NOW })).toMatchObject({ id: 99 })
  })

  it('отвергает испорченный hash', () => {
    const data = signInitData({ id: 99 }, NOW - 60).replace(/hash=\w/, 'hash=0')
    expect(verifyInitData(data, TOKEN, { now: NOW })).toBeNull()
  })

  it('отвергает подпись старше суток', () => {
    const data = signInitData({ id: 99 }, NOW - 86_401)
    expect(verifyInitData(data, TOKEN, { now: NOW })).toBeNull()
  })

  it('отвергает подпись, сделанную другим токеном', () => {
    const data = signInitData({ id: 99 }, NOW - 60)
    expect(verifyInitData(data, '42:OTHER', { now: NOW })).toBeNull()
  })
})

describe('requireAdmin', () => {
  const headers = (initData: string) => new Request('https://x/api', { headers: { 'X-Init-Data': initData } })

  it('пускает админа', () => {
    const req = headers(signInitData({ id: 99 }, NOW - 60))
    expect(requireAdmin(req, { botToken: TOKEN, adminIds: [99], now: NOW })).toMatchObject({ id: 99 })
  })

  it('не пускает валидного, но не-админа', () => {
    const req = headers(signInitData({ id: 7 }, NOW - 60))
    expect(requireAdmin(req, { botToken: TOKEN, adminIds: [99], now: NOW })).toBeNull()
  })

  it('devAdminId работает без подписи', () => {
    const req = new Request('https://x/api')
    expect(requireAdmin(req, { botToken: TOKEN, adminIds: [], devAdminId: 5 })).toMatchObject({ id: 5 })
  })
})
