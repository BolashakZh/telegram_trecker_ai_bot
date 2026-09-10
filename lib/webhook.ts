import type { Update } from 'grammy/types'
import type { Db } from './db.ts'
import { claimUpdate } from './entries.ts'

type UpdateHandler = { handleUpdate(update: Update): Promise<void> }

export async function handleWebhook(
  req: Request,
  deps: { db: Db; bot: () => Promise<UpdateHandler>; secret: string },
): Promise<Response> {
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== deps.secret) {
    return new Response('unauthorized', { status: 401 })
  }

  let update: Update
  try {
    update = (await req.json()) as Update
    if (typeof update.update_id !== 'number') throw new Error('нет update_id')
  } catch (err) {
    // Битое тело не станет валиднее при повторе Telegram — гасим здесь, не ретраим.
    console.error('bad webhook body', err)
    return new Response('bad request')
  }

  let claimed: boolean
  try {
    claimed = await claimUpdate(deps.db, update.update_id)
  } catch (err) {
    // База недоступна: строка в processed не записана — ретрай Telegram может
    // застать её уже живой и не потерять апдейт, поэтому не глотаем ошибку в 200.
    console.error('claimUpdate failed', err)
    return new Response('server error', { status: 500 })
  }
  if (!claimed) return new Response('duplicate')

  try {
    const bot = await deps.bot()
    await bot.handleUpdate(update)
  } catch (err) {
    // Ретрай Telegram уже отсечён таблицей processed — отвечаем 200 и живём дальше.
    console.error('handleUpdate failed', err)
  }
  return new Response('ok')
}
