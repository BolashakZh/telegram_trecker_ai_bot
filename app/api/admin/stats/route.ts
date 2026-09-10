import { statsQuery } from '@/lib/admin.ts'
import { admin } from '@/lib/admin-guard.ts'
import { today } from '@/lib/db.ts'
import { getDb } from '@/lib/runtime.ts'
import { BadRequest } from '@/lib/validate.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  if (!admin(req)) return Response.json({ error: 'Нет доступа' }, { status: 401 })
  const url = new URL(req.url)
  const db = getDb()
  const period = url.searchParams.get('period') === 'month' ? 'month' : 'week'
  try {
    return Response.json(await statsQuery(db, {
      groupId: Number(url.searchParams.get('groupId')),
      period,
      today: await today(db),
    }))
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 })
    console.error(err)
    return Response.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
