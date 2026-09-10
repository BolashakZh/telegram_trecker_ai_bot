import crypto from 'node:crypto'

export type TgUser = { id: number; username?: string; first_name?: string }

export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSec?: number; now?: number } = {},
): TgUser | null {
  const maxAge = opts.maxAgeSec ?? 86_400
  const now = opts.now ?? Math.floor(Date.now() / 1000)

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  // Сортируются уже готовые строки "key=value", а не ключи сами по себе. Для нынешнего
  // набора полей Telegram (auth_date, query_id, user, ...) это эквивалентно сортировке по
  // ключу, т.к. среди них нет ключа, являющегося префиксом другого.
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex')

  const a = Buffer.from(calc, 'hex')
  const b = Buffer.from(hash, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  const authDate = Number(params.get('auth_date'))
  if (!Number.isFinite(authDate) || now - authDate > maxAge) return null

  try {
    const user = JSON.parse(params.get('user') ?? 'null') as TgUser | null
    return user && Number.isFinite(user.id) ? user : null
  } catch {
    return null
  }
}

export function requireAdmin(
  req: Request,
  opts: { botToken: string; adminIds: number[]; devAdminId?: number; now?: number },
): TgUser | null {
  if (opts.devAdminId) return { id: opts.devAdminId, first_name: 'dev' }

  const initData = req.headers.get('X-Init-Data')
  if (!initData) return null

  const user = verifyInitData(initData, opts.botToken, { now: opts.now })
  if (!user || !opts.adminIds.includes(user.id)) return null
  return user
}
