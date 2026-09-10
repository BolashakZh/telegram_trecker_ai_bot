import { config } from '@/lib/config.ts'
import { getBot, getDb } from '@/lib/runtime.ts'
import { handleWebhook } from '@/lib/webhook.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  return handleWebhook(req, {
    db: getDb(),
    bot: async () => {
      const bot = getBot()
      await bot.init()
      return bot
    },
    secret: config.webhookSecret(),
  })
}
