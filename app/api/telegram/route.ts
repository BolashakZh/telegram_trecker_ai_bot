import { config } from '@/lib/config.ts'
import { getBot, getDb } from '@/lib/runtime.ts'
import { handleWebhook } from '@/lib/webhook.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const bot = getBot()
  await bot.init()
  return handleWebhook(req, { db: getDb(), bot, secret: config.webhookSecret() })
}
