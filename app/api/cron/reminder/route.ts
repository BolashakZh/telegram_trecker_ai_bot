import { config } from '@/lib/config.ts'
import { today } from '@/lib/db.ts'
import { sendReminders } from '@/lib/report.ts'
import { getBot, getDb } from '@/lib/runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  if (req.headers.get('Authorization') !== `Bearer ${config.cronSecret()}`) {
    return new Response('unauthorized', { status: 401 })
  }

  const db = getDb()
  const bot = getBot()
  await bot.init()

  const sent = await sendReminders(db, {
    send: async (chatId, text, keyboard) => {
      await bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      })
    },
  }, await today(db))

  return Response.json({ sent })
}
