import type { Db } from './db.ts'
import type { User } from './users.ts'

export type Group = {
  id: number
  title: string
  chat_id: number | null
  archived_at: string | null
}

const COLS = `id, title, chat_id::int8 as chat_id, archived_at::text as archived_at`

function toGroup(row: Record<string, unknown>): Group {
  return {
    id: Number(row.id),
    title: row.title as string,
    chat_id: row.chat_id == null ? null : Number(row.chat_id),
    archived_at: (row.archived_at as string) ?? null,
  }
}

export async function createGroup(db: Db, title: string): Promise<Group> {
  const [row] = await db.q(`insert into groups (title) values ($1) returning ${COLS}`, [title])
  return toGroup(row)
}

export async function renameGroup(db: Db, id: number, title: string): Promise<void> {
  await db.q(`update groups set title = $2 where id = $1`, [id, title])
}

export async function archiveGroup(db: Db, id: number): Promise<void> {
  await db.q(`update groups set archived_at = now() where id = $1`, [id])
}

export async function bindChat(db: Db, groupId: number, chatId: number): Promise<void> {
  // Один оператор — атомарен даже без явной транзакции (HTTP-драйвер Neon
  // шлёт каждый вызов db.q отдельным запросом, между ними транзакции нет).
  // chat_id уникален, поэтому порядок важен: сперва CTE ставит chat_id новой
  // группе, затем внешний update снимает его со старой. Обратный порядок
  // (сначала снять, потом поставить одним CASE-update) при повторных
  // перепривязках ловит "duplicate key value violates unique constraint" —
  // Postgres не гарантирует, в каком порядке будут обработаны строки одного
  // UPDATE, и прежний владелец может обработаться позже нового.
  await db.q(
    `with setnew as (
       update groups set chat_id = $2 where id = $1 returning id
     )
     update groups set chat_id = null where chat_id = $2 and id <> $1`,
    [groupId, chatId],
  )
}

export async function unbindChat(db: Db, groupId: number): Promise<void> {
  await db.q(`update groups set chat_id = null where id = $1`, [groupId])
}

export async function listGroups(
  db: Db,
  opts: { includeArchived?: boolean } = {},
): Promise<Group[]> {
  const where = opts.includeArchived ? '' : 'where archived_at is null'
  const rows = await db.q(`select ${COLS} from groups ${where} order by id`)
  return rows.map(toGroup)
}

// Возвращает true, только когда членство было создано впервые (INSERT реально
// вставил строку) — вызывающий код на это опирается, чтобы уведомить о новом
// доступе только один раз, а не при каждом повторном тапе по уже включённой группе.
export async function setMembership(
  db: Db, userId: number, groupId: number, on: boolean,
): Promise<boolean> {
  if (on) {
    const rows = await db.q(
      `insert into memberships (user_id, group_id) values ($1, $2)
       on conflict do nothing returning user_id`,
      [userId, groupId],
    )
    return rows.length > 0
  }
  await db.q(`delete from memberships where user_id = $1 and group_id = $2`, [userId, groupId])
  return false
}

export async function userGroups(db: Db, userId: number): Promise<Group[]> {
  const rows = await db.q(
    `select g.id, g.title, g.chat_id::int8 as chat_id, g.archived_at::text as archived_at
     from memberships m join groups g on g.id = m.group_id
     where m.user_id = $1 and g.archived_at is null
     order by g.id`,
    [userId],
  )
  return rows.map(toGroup)
}

export async function groupMembers(db: Db, groupId: number): Promise<User[]> {
  const rows = await db.q(
    `select u.id::int8 as id, u.username, u.first_name, u.display_name, u.name_locked
     from memberships m join users u on u.id = m.user_id
     where m.group_id = $1
     order by coalesce(u.display_name, u.first_name, ''), u.id`,
    [groupId],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    username: (r.username as string) ?? null,
    first_name: (r.first_name as string) ?? null,
    display_name: (r.display_name as string) ?? null,
    name_locked: Boolean(r.name_locked),
  }))
}
