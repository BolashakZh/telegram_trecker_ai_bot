import { bootstrap } from '@/lib/admin.ts'
import { admin } from '@/lib/admin-guard.ts'
import { getDb } from '@/lib/runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  if (!admin(req)) return Response.json({ error: 'Нет доступа' }, { status: 401 })
  return Response.json(await bootstrap(getDb()))
}
