import type { Db } from './db.ts'
import { personName } from './text.ts'
import { BadRequest } from './validate.ts'

export type MemberScore = {
  user_id: number; name: string; done: number; expected: number; percent: number
}
export type TrackerScore = {
  tracker_id: number; title: string; kind: 'check' | 'number'
  percent: number; sum: number; unit: string | null
}
export type DayCell = { user_id: number; day: string; percent: number }
export type GroupReport = {
  group_id: number; title: string; from: string; to: string
  members: MemberScore[]; trackers: TrackerScore[]; days: DayCell[]; percent: number
}

const pct = (done: number, expected: number) =>
  expected > 0 ? Math.round((done / expected) * 100) : 0

// Пары (участник, трекер группы) со своей датой старта — основа всех трёх
// выборок groupReport и missingToday. Момент вступления/привязки приводится
// к дате в таймзоне проекта ($2 = db.tz), а не к сессионной таймзоне Postgres
// (у Neon и в тестовой PGlite-базе это UTC) — иначе вечернее по местному
// времени вступление сдвигается на предыдущий день и даёт лишний ожидаемый
// день / ложный ноль в сводке. См. тот же приём в lib/stats.ts.
const PAIRS = `
  select m.user_id, t.id as tracker_id, t.title, t.kind, t.unit, t.target::float8 as target,
         (greatest(m.joined_at, gt.linked_at, t.created_at) at time zone $2)::date as start_day
  from memberships m
  join group_trackers gt on gt.group_id = m.group_id
  join trackers t on t.id = gt.tracker_id and t.archived_at is null
  where m.group_id = $1
`

export async function groupReport(
  db: Db, groupId: number, from: string, to: string,
): Promise<GroupReport> {
  const [g] = await db.q(`select id, title from groups where id = $1`, [groupId])
  if (!g) throw new BadRequest('Группа не найдена')

  const members = await db.q(
    `with pairs as (${PAIRS}),
     per_pair as (
       select p.user_id, p.tracker_id,
              greatest(0, ($4::date - greatest(p.start_day, $3::date)) + 1)::int as expected,
              (select count(*)::int from entries e
                where e.user_id = p.user_id and e.tracker_id = p.tracker_id
                  and e.value >= p.target
                  and e.day between greatest(p.start_day, $3::date) and $4::date) as done
       from pairs p
     )
     select u.id::int8 as user_id, u.display_name, u.first_name, u.username,
            sum(pp.expected)::int as expected,
            sum(pp.done)::int as done
     from per_pair pp
     join users u on u.id = pp.user_id
     group by u.id, u.display_name, u.first_name, u.username
     order by coalesce(u.display_name, u.first_name, ''), u.id`,
    [groupId, db.tz, from, to],
  )

  const trackers = await db.q(
    `with pairs as (${PAIRS}),
     per_pair as (
       select p.tracker_id, p.title, p.kind, p.unit,
              greatest(0, ($4::date - greatest(p.start_day, $3::date)) + 1)::int as expected,
              (select count(*)::int from entries e
                where e.user_id = p.user_id and e.tracker_id = p.tracker_id
                  and e.value >= p.target
                  and e.day between greatest(p.start_day, $3::date) and $4::date) as done,
              (select coalesce(sum(e.value), 0)::float8 from entries e
                where e.user_id = p.user_id and e.tracker_id = p.tracker_id
                  and e.day between greatest(p.start_day, $3::date) and $4::date) as sum
       from pairs p
     )
     select tracker_id, title, kind, unit,
            sum(expected)::int as expected,
            sum(done)::int as done,
            sum(sum)::float8 as sum
     from per_pair
     group by tracker_id, title, kind, unit
     order by tracker_id`,
    [groupId, db.tz, from, to],
  )

  const days = await db.q(
    `with pairs as (${PAIRS}),
     grid as (
       select p.user_id, p.tracker_id, p.target, d::date as day
       from pairs p,
            generate_series(greatest(p.start_day, $3::date), $4::date, interval '1 day') d
     )
     select grid.user_id::int8 as user_id, grid.day::text as day,
            (100.0 * count(*) filter (
               where exists (select 1 from entries e
                             where e.user_id = grid.user_id and e.tracker_id = grid.tracker_id
                               and e.day = grid.day and e.value >= grid.target)
             ) / count(*))::float8 as percent
     from grid
     group by grid.user_id, grid.day
     order by grid.user_id, grid.day`,
    [groupId, db.tz, from, to],
  )

  const memberScores: MemberScore[] = members.map((r) => ({
    user_id: Number(r.user_id),
    name: personName({
      id: Number(r.user_id),
      display_name: (r.display_name as string) ?? null,
      first_name: (r.first_name as string) ?? null,
      username: (r.username as string) ?? null,
    }),
    done: Number(r.done),
    expected: Number(r.expected),
    percent: pct(Number(r.done), Number(r.expected)),
  }))

  return {
    group_id: Number(g.id),
    title: g.title as string,
    from,
    to,
    members: memberScores,
    trackers: trackers.map((r) => ({
      tracker_id: Number(r.tracker_id),
      title: r.title as string,
      kind: r.kind as 'check' | 'number',
      unit: (r.unit as string) ?? null,
      percent: pct(Number(r.done), Number(r.expected)),
      sum: Number(r.sum),
    })),
    days: days.map((r) => ({
      user_id: Number(r.user_id),
      day: r.day as string,
      percent: Math.round(Number(r.percent)),
    })),
    percent: memberScores.length
      ? Math.round(memberScores.reduce((a, m) => a + m.percent, 0) / memberScores.length)
      : 0,
  }
}

export async function missingToday(
  db: Db, groupId: number, today: string,
): Promise<{ user_id: number; name: string; titles: string[] }[]> {
  const rows = await db.q(
    `with pairs as (${PAIRS})
     select u.id::int8 as user_id, u.display_name, u.first_name, u.username,
            array_agg(p.title order by p.tracker_id) as titles
     from pairs p
     join users u on u.id = p.user_id
     where p.start_day <= $3::date
       and not exists (select 1 from entries e
                       where e.user_id = p.user_id and e.tracker_id = p.tracker_id
                         and e.day = $3::date and e.value >= p.target)
     group by u.id, u.display_name, u.first_name, u.username
     order by coalesce(u.display_name, u.first_name, ''), u.id`,
    [groupId, db.tz, today],
  )
  return rows.map((r) => ({
    user_id: Number(r.user_id),
    name: personName({
      id: Number(r.user_id),
      display_name: (r.display_name as string) ?? null,
      first_name: (r.first_name as string) ?? null,
      username: (r.username as string) ?? null,
    }),
    titles: r.titles as string[],
  }))
}

export async function usersWithUnfinished(
  db: Db, today: string,
): Promise<{ user_id: number; count: number }[]> {
  const rows = await db.q(
    `select m.user_id::int8 as user_id, count(distinct t.id)::int as count
     from memberships m
     join groups g on g.id = m.group_id and g.archived_at is null
     join group_trackers gt on gt.group_id = g.id
     join trackers t on t.id = gt.tracker_id and t.archived_at is null
     where (greatest(m.joined_at, gt.linked_at, t.created_at) at time zone $2)::date <= $1::date
       and not exists (select 1 from entries e
                       where e.user_id = m.user_id and e.tracker_id = t.id
                         and e.day = $1::date and e.value >= t.target)
     group by m.user_id
     order by m.user_id`,
    [today, db.tz],
  )
  return rows.map((r) => ({ user_id: Number(r.user_id), count: Number(r.count) }))
}
