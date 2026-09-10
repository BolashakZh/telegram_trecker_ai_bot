import type { Db } from './db.ts'

export type User = {
  id: number
  username: string | null
  first_name: string | null
  display_name: string | null
  name_locked: boolean
}

const COLS = `id::int8 as id, username, first_name, display_name, name_locked`

function toUser(row: Record<string, unknown>): User {
  return {
    id: Number(row.id),
    username: (row.username as string) ?? null,
    first_name: (row.first_name as string) ?? null,
    display_name: (row.display_name as string) ?? null,
    name_locked: Boolean(row.name_locked),
  }
}

export async function upsertFromTelegram(
  db: Db,
  tg: { id: number; username?: string; first_name?: string },
): Promise<User> {
  const [row] = await db.q(
    `insert into users (id, username, first_name) values ($1, $2, $3)
     on conflict (id) do update set username = excluded.username,
                                    first_name = excluded.first_name
     returning ${COLS}`,
    [tg.id, tg.username ?? null, tg.first_name ?? null],
  )
  return toUser(row)
}

export async function getUser(db: Db, id: number): Promise<User | null> {
  const [row] = await db.q(`select ${COLS} from users where id = $1`, [id])
  return row ? toUser(row) : null
}

export function normalizeName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 40) return null
  if (!/\p{L}/u.test(name)) return null
  return name
}

export async function setDisplayName(
  db: Db,
  id: number,
  raw: string,
  opts: { byAdmin: boolean },
): Promise<{ ok: true; name: string } | { ok: false; reason: 'locked' | 'invalid' }> {
  const name = normalizeName(raw)
  if (!name) return { ok: false, reason: 'invalid' }

  if (!opts.byAdmin) {
    const current = await getUser(db, id)
    if (current?.name_locked) return { ok: false, reason: 'locked' }
  }

  await db.q(
    `update users set display_name = $2, name_locked = name_locked or $3 where id = $1`,
    [id, name, opts.byAdmin],
  )
  return { ok: true, name }
}

export async function unlockName(db: Db, id: number): Promise<void> {
  await db.q(`update users set name_locked = false where id = $1`, [id])
}

const COLS_U = `u.id::int8 as id, u.username, u.first_name, u.display_name, u.name_locked`

export async function listUsers(db: Db): Promise<(User & { group_ids: number[] })[]> {
  const rows = await db.q(
    `select ${COLS_U},
            coalesce(array_agg(m.group_id order by m.group_id)
                     filter (where m.group_id is not null), '{}') as group_ids
     from users u left join memberships m on m.user_id = u.id
     group by u.id
     order by (count(m.group_id) = 0) desc, coalesce(u.display_name, u.first_name, '')`,
    [],
  )
  return rows.map((r) => ({ ...toUser(r), group_ids: (r.group_ids as number[]).map(Number) }))
}
