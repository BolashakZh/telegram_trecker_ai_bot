import type { Update } from 'grammy/types'
import type { Db } from './db.ts'
import { claimUpdate } from './entries.ts'

type UpdateHandler = { handleUpdate(update: Update): Promise<void> }

export async function handleWebhook(
  req: Request,
  deps: { db: Db; bot: UpdateHandler; secret: string },
): Promise<Response> {
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== deps.secret) {
    return new Response('unauthorized', { status: 401 })
  }

  const update = (await req.json()) as Update
  if (!(await claimUpdate(deps.db, update.update_id))) return new Response('duplicate')

  try {
    await deps.bot.handleUpdate(update)
  } catch (err) {
    // Ретрай Telegram уже отсечён таблицей processed — отвечаем 200 и живём дальше.
    console.error('handleUpdate failed', err)
  }
  return new Response('ok')
}
