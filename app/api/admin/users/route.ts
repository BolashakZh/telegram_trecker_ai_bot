import { usersAction } from '@/lib/admin.ts'
import { admin } from '@/lib/admin-guard.ts'
import { sendAccessGranted } from '@/lib/report.ts'
import { getBot, getDb } from '@/lib/runtime.ts'
import { BadRequest } from '@/lib/validate.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  if (!admin(req)) return Response.json({ error: 'Нет доступа' }, { status: 401 })
  try {
    const db = getDb()
    const users = await usersAction(db, await req.json(), {
      onGranted: async (userId, group) => {
        const bot = getBot()
        await bot.init()
        await sendAccessGranted(db, {
          send: async (chatId, text, keyboard) => {
            await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard })
          },
        }, userId, group.title)
      },
    })
    return Response.json({ users })
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 })
    console.error(err)
    return Response.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
