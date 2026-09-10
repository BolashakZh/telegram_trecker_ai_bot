import type { Db } from './db.ts'

export type TrackerKind = 'check' | 'number'

export type Tracker = {
  id: number
  title: string
  description: string | null
  kind: TrackerKind
  target: number
  unit: string | null
  archived_at: string | null
}

const COLS = `id, title, description, kind, target::float8 as target, unit, archived_at::text as archived_at`
const COLS_T = `t.id, t.title, t.description, t.kind, t.target::float8 as target, t.unit,
                t.archived_at::text as archived_at`

function toTracker(row: Record<string, unknown>): Tracker {
  return {
    id: Number(row.id),
    title: row.title as string,
    description: (row.description as string) ?? null,
    kind: row.kind as TrackerKind,
    target: Number(row.target),
    unit: (row.unit as string) ?? null,
    archived_at: (row.archived_at as string) ?? null,
  }
}

export async function createTracker(
  db: Db,
  t: { title: string; kind: TrackerKind; target?: number; unit?: string | null; description?: string | null },
): Promise<Tracker> {
  const [row] = await db.q(
    `insert into trackers (title, description, kind, target, unit) values ($1, $2, $3, $4, $5)
     returning ${COLS}`,
    [
      t.title,
      t.description ?? null,
      t.kind,
      t.kind === 'check' ? 1 : (t.target ?? 1),
      t.kind === 'check' ? null : (t.unit ?? null),
    ],
  )
  return toTracker(row)
}

export async function updateTracker(
  db: Db,
  id: number,
  t: { title: string; target: number; unit: string | null; description: string | null },
): Promise<void> {
  await db.q(
    `update trackers set title = $2, description = $3, target = $4, unit = $5 where id = $1`,
    [id, t.title, t.description, t.target, t.unit],
  )
}

export async function archiveTracker(db: Db, id: number): Promise<void> {
  await db.q(`update trackers set archived_at = now() where id = $1`, [id])
}

export async function listTrackers(
  db: Db,
  opts: { includeArchived?: boolean } = {},
): Promise<(Tracker & { group_ids: number[] })[]> {
  const where = opts.includeArchived ? '' : 'where t.archived_at is null'
  const rows = await db.q(
    `select ${COLS_T},
            coalesce(array_agg(gt.group_id order by gt.group_id)
                     filter (where gt.group_id is not null), '{}') as group_ids
     from trackers t left join group_trackers gt on gt.tracker_id = t.id
     ${where}
     group by t.id
     order by t.id`,
  )
  return rows.map((r) => ({ ...toTracker(r), group_ids: (r.group_ids as number[]).map(Number) }))
}

export async function setGroupTracker(
  db: Db, groupId: number, trackerId: number, on: boolean,
): Promise<void> {
  if (on) {
    await db.q(
      `insert into group_trackers (group_id, tracker_id) values ($1, $2) on conflict do nothing`,
      [groupId, trackerId],
    )
  } else {
    await db.q(`delete from group_trackers where group_id = $1 and tracker_id = $2`,
      [groupId, trackerId])
  }
}

export async function activeTrackersForUser(db: Db, userId: number): Promise<Tracker[]> {
  const rows = await db.q(
    `select distinct on (t.id)
            ${COLS_T}
     from memberships m
     join groups g on g.id = m.group_id and g.archived_at is null
     join group_trackers gt on gt.group_id = g.id
     join trackers t on t.id = gt.tracker_id and t.archived_at is null
     where m.user_id = $1
     order by t.id`,
    [userId],
  )
  return rows.map(toTracker)
}
