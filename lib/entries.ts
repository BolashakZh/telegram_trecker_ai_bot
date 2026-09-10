import type { Db } from './db.ts'

export type DayState = { tracker_id: number; value: number; done: boolean }

export async function toggleCheck(
  db: Db, userId: number, trackerId: number, day: string,
): Promise<{ done: boolean }> {
  // Один оператор — атомарен даже без явной транзакции (см. bindChat в
  // lib/groups.ts). DELETE берёт блокировку строки по первичному ключу;
  // параллельный вызов того же тоггла (двойной тап, повтор апдейта от
  // Telegram) дожидается этой блокировки и видит уже изменённое состояние,
  // поэтому INSERT ... WHERE NOT EXISTS не вставит вторую строку и не
  // вернёт нас в "поставлено" вместо исходного "снято".
  const rows = await db.q(
    `with del as (
       delete from entries
        where user_id = $1 and tracker_id = $2 and day = $3::date
       returning 1
     )
     insert into entries (user_id, tracker_id, day, value)
     select $1, $2, $3::date, 1
      where not exists (select 1 from del)
     returning value`,
    [userId, trackerId, day],
  )
  return { done: rows.length > 0 }
}

export async function setValue(
  db: Db, userId: number, trackerId: number, day: string, value: number,
): Promise<{ done: boolean; cleared: boolean }> {
  if (value <= 0) {
    await db.q(`delete from entries where user_id = $1 and tracker_id = $2 and day = $3::date`,
      [userId, trackerId, day])
    return { done: false, cleared: true }
  }

  const [row] = await db.q(
    `insert into entries (user_id, tracker_id, day, value) values ($1, $2, $3::date, $4)
     on conflict (user_id, tracker_id, day) do update set value = excluded.value
     returning (value >= (select target from trackers where id = $2)) as done`,
    [userId, trackerId, day, value],
  )
  return { done: Boolean(row.done), cleared: false }
}

export async function dayState(
  db: Db, userId: number, day: string,
): Promise<Map<number, DayState>> {
  const rows = await db.q(
    `select e.tracker_id, e.value::float8 as value, (e.value >= t.target) as done
     from entries e join trackers t on t.id = e.tracker_id
     where e.user_id = $1 and e.day = $2::date`,
    [userId, day],
  )
  return new Map(rows.map((r) => [
    Number(r.tracker_id),
    { tracker_id: Number(r.tracker_id), value: Number(r.value), done: Boolean(r.done) },
  ]))
}

export function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export async function claimUpdate(db: Db, updateId: number): Promise<boolean> {
  const rows = await db.q(
    `insert into processed (update_id) values ($1) on conflict do nothing returning update_id`,
    [updateId],
  )
  await db.q(`delete from processed where at < now() - interval '1 day'`)
  return rows.length > 0
}

export async function setPending(db: Db, userId: number, trackerId: number): Promise<void> {
  await db.q(
    `insert into pending_input (user_id, tracker_id, at) values ($1, $2, now())
     on conflict (user_id) do update set tracker_id = excluded.tracker_id, at = now()`,
    [userId, trackerId],
  )
}

export async function takePending(
  db: Db, userId: number, maxAgeMinutes = 15,
): Promise<number | null> {
  const [row] = await db.q(
    `select tracker_id from pending_input
     where user_id = $1 and at > now() - ($2 || ' minutes')::interval`,
    [userId, String(maxAgeMinutes)],
  )
  return row ? Number(row.tracker_id) : null
}

export async function clearPending(db: Db, userId: number): Promise<void> {
  await db.q(`delete from pending_input where user_id = $1`, [userId])
}
