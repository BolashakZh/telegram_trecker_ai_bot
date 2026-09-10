import { config } from '@/lib/config.ts'
import { migrate } from '@/lib/db.ts'
import { getBot, getDb } from '@/lib/runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const key = new URL(req.url).searchParams.get('key')
  if (key !== config.setupSecret()) return new Response('unauthorized', { status: 401 })

  await migrate(getDb())

  const bot = getBot()
  await bot.init()
  await bot.api.setWebhook(`${config.appUrl()}/api/telegram`, {
    secret_token: config.webhookSecret(),
    allowed_updates: ['message', 'callback_query'],
  })
  await bot.api.setChatMenuButton({
    menu_button: { type: 'web_app', text: 'Админка', web_app: { url: `${config.appUrl()}/admin` } },
  })

  return Response.json({ ok: true })
}
