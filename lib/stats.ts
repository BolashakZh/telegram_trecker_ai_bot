import type { Db } from './db.ts'
import type { Tracker } from './trackers.ts'

export type TrackerStats = {
  tracker: Tracker
  start_day: string
  done_week: number
  expected_week: number
  done_month: number
  expected_month: number
  streak: number
  misses: number
  sum_week: number
}

export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  const shift = (d.getUTCDay() + 6) % 7 // пн = 0
  d.setUTCDate(d.getUTCDate() - shift)
  return d.toISOString().slice(0, 10)
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`
}

// pair       — начало отсчёта пары (человек, трекер): минимум по группам
//              от максимума (joined_at, linked_at, tracker.created_at) — §4 спеки.
// done       — дни этой пары, где value >= target, не раньше start_day и не позже today.
// streak_*   — «острова» подряд идущих выполненных дней (day - row_number() над
//              отсортированными днями даёт одно и то же значение внутри острова);
//              берём последний остров и обнуляем серию, если он не дотянул до
//              вчера (день ещё не кончился, поэтому сегодня без отметки не в счёт).
const SQL = `
with pair as (
  select t.id as tracker_id, t.title, t.description, t.kind,
         t.target::float8 as target, t.unit,
         min(greatest(m.joined_at, gt.linked_at, t.created_at))::date as start_day
  from memberships m
  join groups g on g.id = m.group_id and g.archived_at is null
  join group_trackers gt on gt.group_id = g.id
  join trackers t on t.id = gt.tracker_id and t.archived_at is null
  where m.user_id = $1
  group by t.id
),
done as (
  select p.tracker_id, e.day
  from pair p
  join entries e
    on e.tracker_id = p.tracker_id and e.user_id = $1
   and e.value >= p.target and e.day >= p.start_day and e.day <= $2::date
),
streak_grp as (
  select tracker_id, day,
         (day - (row_number() over (partition by tracker_id order by day))::int) as g
  from done
),
streak_islands as (
  select tracker_id, g, max(day) as max_day, count(*)::int as len
  from streak_grp
  group by tracker_id, g
),
streak_last as (
  select distinct on (tracker_id) tracker_id, max_day, len
  from streak_islands
  order by tracker_id, max_day desc
),
streak as (
  select tracker_id,
         case when max_day >= $2::date - 1 then len else 0 end as streak
  from streak_last
)
select
  p.tracker_id, p.title, p.description, p.kind, p.target, p.unit,
  p.start_day::text as start_day,
  greatest(0, ($2::date - greatest(p.start_day, $3::date)) + 1)::int as expected_week,
  greatest(0, ($2::date - greatest(p.start_day, $4::date)) + 1)::int as expected_month,
  (select count(*)::int from done d
    where d.tracker_id = p.tracker_id and d.day >= greatest(p.start_day, $3::date)) as done_week,
  (select count(*)::int from done d
    where d.tracker_id = p.tracker_id and d.day >= greatest(p.start_day, $4::date)) as done_month,
  coalesce((select sum(e.value)::float8 from entries e
            where e.user_id = $1 and e.tracker_id = p.tracker_id
              and e.day between greatest(p.start_day, $3::date) and $2::date), 0) as sum_week,
  coalesce((select streak from streak s where s.tracker_id = p.tracker_id), 0)::int as streak,
  greatest(
    0,
    greatest(0, ($2::date - p.start_day))
      - (select count(*)::int from done d
         where d.tracker_id = p.tracker_id and d.day <= $2::date - 1)
  )::int as misses
from pair p
order by p.tracker_id
`

export async function userStats(db: Db, userId: number, today: string): Promise<TrackerStats[]> {
  const rows = await db.q(SQL, [userId, today, weekStart(today), monthStart(today)])
  return rows.map((r) => ({
    tracker: {
      id: Number(r.tracker_id),
      title: r.title as string,
      description: (r.description as string) ?? null,
      kind: r.kind as Tracker['kind'],
      target: Number(r.target),
      unit: (r.unit as string) ?? null,
      archived_at: null,
    },
    start_day: r.start_day as string,
    done_week: Number(r.done_week),
    expected_week: Number(r.expected_week),
    done_month: Number(r.done_month),
    expected_month: Number(r.expected_month),
    streak: Number(r.streak),
    misses: Number(r.misses),
    sum_week: Number(r.sum_week),
  }))
}
