import { PGlite } from '@electric-sql/pglite'
import { createDb, migrate, type Db } from '../lib/db.ts'

export async function testDb(tz = 'Asia/Almaty'): Promise<Db> {
  const pg = new PGlite()
  const db = createDb(async (text, params = []) => {
    const res = await pg.query(text, params as unknown[])
    return res.rows as Record<string, unknown>[]
  }, tz)
  await migrate(db)
  return db
}
