import { config } from '@/lib/config.ts'
import { today } from '@/lib/db.ts'
import { sendWeekly } from '@/lib/report.ts'
import { getBot, getDb } from '@/lib/runtime.ts'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  // config.cronSecret() бросает, если переменная не задана — без try/catch
  // это была бы неперехваченная 500 со стектрейсом вместо честной 401.
  let secret: string
  try {
    secret = config.cronSecret()
  } catch (err) {
    console.error(err)
    return Response.json({ error: 'Нет доступа' }, { status: 401 })
  }
  if (req.headers.get('Authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Нет доступа' }, { status: 401 })
  }

  try {
    const db = getDb()
    const bot = getBot()
    await bot.init()

    const sent = await sendWeekly(db, {
      send: async (chatId, text) => {
        await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' })
      },
    }, await today(db))

    return Response.json({ sent })
  } catch (err) {
    console.error(err)
    return Response.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
