import { neon } from '@neondatabase/serverless'

export type Row = Record<string, unknown>
export type Query = (text: string, params?: unknown[]) => Promise<Row[]>
export type Db = { q: Query; tz: string }

export function createDb(q: Query, tz: string): Db {
  return { q, tz }
}

export function neonDb(url: string, tz: string): Db {
  const sql = neon(url)
  const q: Query = async (text, params = []) => {
    try {
      return (await sql.query(text, params)) as Row[]
    } catch (err) {
      // Neon засыпает после простоя: один повтор перед тем, как сдаться.
      if (!isConnectionError(err)) throw err
      return (await sql.query(text, params)) as Row[]
    }
  }
  return createDb(q, tz)
}

function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /fetch failed|ECONNRESET|ETIMEDOUT|connection|timeout/i.test(msg)
}

const SCHEMA = `
create table if not exists users (
  id           bigint primary key,
  username     text,
  first_name   text,
  display_name text,
  name_locked  boolean not null default false,
  created_at   timestamptz not null default now()
);
create table if not exists groups (
  id          serial primary key,
  title       text not null,
  chat_id     bigint unique,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create table if not exists trackers (
  id          serial primary key,
  title       text not null,
  kind        text not null check (kind in ('check','number')),
  target      numeric not null default 1 check (target > 0),
  unit        text,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create table if not exists group_trackers (
  group_id   int not null references groups(id),
  tracker_id int not null references trackers(id),
  linked_at  timestamptz not null default now(),
  primary key (group_id, tracker_id)
);
create table if not exists memberships (
  user_id   bigint not null references users(id),
  group_id  int not null references groups(id),
  joined_at timestamptz not null default now(),
  primary key (user_id, group_id)
);
create table if not exists entries (
  user_id    bigint not null references users(id),
  tracker_id int not null references trackers(id),
  day        date not null,
  value      numeric not null default 1,
  created_at timestamptz not null default now(),
  primary key (user_id, tracker_id, day)
);
create table if not exists pending_input (
  user_id    bigint primary key references users(id),
  tracker_id int not null references trackers(id),
  at         timestamptz not null default now()
);
create table if not exists processed (
  update_id bigint primary key,
  at        timestamptz not null default now()
);
create table if not exists sent_log (
  kind text not null,
  key  text not null,
  at   timestamptz not null default now(),
  primary key (kind, key)
);
create index if not exists entries_day_idx on entries (day);
create index if not exists memberships_group_idx on memberships (group_id);
`

export async function migrate(db: Db): Promise<void> {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.q(stmt)
  }
}

export async function today(db: Db): Promise<string> {
  const [row] = await db.q(`select (now() at time zone $1)::date::text as day`, [db.tz])
  return row.day as string
}

export async function dayAt(db: Db, iso: string): Promise<string> {
  const [row] = await db.q(
    `select ($1::timestamptz at time zone $2)::date::text as day`,
    [iso, db.tz],
  )
  return row.day as string
}
