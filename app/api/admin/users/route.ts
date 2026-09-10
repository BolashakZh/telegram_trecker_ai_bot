import { usersAction } from '@/lib/admin.ts'
import { admin } from '@/lib/admin-guard.ts'
import { getDb } from '@/lib/runtime.ts'
import { BadRequest } from '@/lib/validate.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  if (!admin(req)) return Response.json({ error: 'Нет доступа' }, { status: 401 })
  try {
    return Response.json({ users: await usersAction(getDb(), await req.json()) })
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 })
    console.error(err)
    return Response.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
