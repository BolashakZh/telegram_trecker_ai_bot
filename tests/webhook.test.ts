import { describe, expect, it, vi } from 'vitest'
import { handleWebhook } from '../lib/webhook.ts'
import { testDb } from './helpers.ts'

function req(body: unknown, secret?: string): Request {
  return new Request('https://example.com/api/telegram', {
    method: 'POST',
    headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {},
    body: JSON.stringify(body),
  })
}

describe('handleWebhook', () => {
  it('без правильного секрета отвечает 401 и не трогает бота', async () => {
    const db = await testDb()
    const bot = { handleUpdate: vi.fn() }
    const res = await handleWebhook(req({ update_id: 1 }), { db, bot: bot as never, secret: 'S' })
    expect(res.status).toBe(401)
    expect(bot.handleUpdate).not.toHaveBeenCalled()
  })

  it('обрабатывает апдейт один раз, повтор проглатывает', async () => {
    const db = await testDb()
    const bot = { handleUpdate: vi.fn() }
    const deps = { db, bot: bot as never, secret: 'S' }

    expect((await handleWebhook(req({ update_id: 5 }, 'S'), deps)).status).toBe(200)
    expect((await handleWebhook(req({ update_id: 5 }, 'S'), deps)).status).toBe(200)
    expect(bot.handleUpdate).toHaveBeenCalledTimes(1)
  })

  it('исключение в обработчике всё равно даёт 200', async () => {
    const db = await testDb()
    const bot = { handleUpdate: vi.fn().mockRejectedValue(new Error('bang')) }
    const res = await handleWebhook(req({ update_id: 9 }, 'S'), { db, bot: bot as never, secret: 'S' })
    expect(res.status).toBe(200)
  })
})
