import { PGlite } from '@electric-sql/pglite'
import { createDb, migrate, type Db } from '../lib/db.ts'

export async function testDb(tz = 'Asia/Almaty'): Promise<Db> {
  const pg = new PGlite()
  const db = createDb(async (text, params = []) => {
    const res = await pg.query(text, params as unknown[])
    return res.rows as Record<string, unknown>[]
  }, tz)
  // PGlite иначе наследует таймзону хост-машины — тесты вели бы себя по-разному
  // на разных машинах/CI. Neon тоже держит сессию в UTC, так что это ещё и
  // приближает тестовую БД к проду для любого кода, где зона не задана явно.
  await db.q(`set time zone 'UTC'`)
  await migrate(db)
  return db
}
