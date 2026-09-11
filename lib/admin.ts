import type { Db } from './db.ts'
import {
  archiveGroup, createGroup, listGroups, renameGroup, setMembership, unbindChat, type Group,
} from './groups.ts'
import { groupReport, type GroupReport } from './group-stats.ts'
import { monthStart, weekStart } from './stats.ts'
import {
  archiveTracker, createTracker, listTrackers, setGroupTracker, updateTracker, type Tracker,
} from './trackers.ts'
import { listUsers, setDisplayName, unlockName, type User } from './users.ts'
import { BadRequest, flag, id, title, trackerInput } from './validate.ts'

export type Bootstrap = {
  groups: Group[]
  trackers: (Tracker & { group_ids: number[] })[]
  users: (User & { group_ids: number[] })[]
}

export async function bootstrap(db: Db): Promise<Bootstrap> {
  const [groups, trackers, users] = await Promise.all([
    listGroups(db), listTrackers(db), listUsers(db),
  ])
  return { groups, trackers, users }
}

export async function usersAction(
  db: Db,
  body: unknown,
  hooks?: { onGranted?: (userId: number, group: Group) => Promise<void> },
): Promise<Bootstrap['users']> {
  const o = (body ?? {}) as Record<string, unknown>
  const userId = id(o.userId)

  switch (o.action) {
    case 'rename': {
      const res = await setDisplayName(db, userId, String(o.displayName ?? ''), { byAdmin: true })
      if (!res.ok) throw new BadRequest('Имя: 2–40 символов, хотя бы одна буква')
      break
    }
    case 'unlockName':
      await unlockName(db, userId)
      break
    case 'membership': {
      const groupId = id(o.groupId)
      const granted = await setMembership(db, userId, groupId, flag(o.on))
      if (granted) {
        const group = (await listGroups(db)).find((g) => g.id === groupId)
        if (group) {
          try {
            await hooks?.onGranted?.(userId, group)
          } catch (err) {
            // Человек мог заблокировать бота или ещё не написать ему /start —
            // это не повод возвращать админке 500 за успешно выданный доступ.
            console.error('usersAction: onGranted hook failed', err)
          }
        }
      }
      break
    }
    default:
      throw new BadRequest('Неизвестное действие')
  }
  return listUsers(db)
}

export async function groupsAction(
  db: Db, body: unknown,
): Promise<{ groups: Group[]; trackers: Bootstrap['trackers'] }> {
  const o = (body ?? {}) as Record<string, unknown>

  switch (o.action) {
    case 'create':
      await createGroup(db, title(o.title))
      break
    case 'rename':
      await renameGroup(db, id(o.groupId), title(o.title))
      break
    case 'archive':
      await archiveGroup(db, id(o.groupId))
      break
    case 'unbindChat':
      await unbindChat(db, id(o.groupId))
      break
    case 'tracker': {
      const trackerId = id(o.trackerId)
      const on = flag(o.on)
      if (on) {
        const known = await listTrackers(db)
        if (!known.some((t) => t.id === trackerId)) {
          throw new BadRequest('Архивный трекер нельзя привязать к группе')
        }
      }
      await setGroupTracker(db, id(o.groupId), trackerId, on)
      break
    }
    default:
      throw new BadRequest('Неизвестное действие')
  }

  const [groups, trackers] = await Promise.all([listGroups(db), listTrackers(db)])
  return { groups, trackers }
}

export async function trackersAction(db: Db, body: unknown): Promise<Bootstrap['trackers']> {
  const o = (body ?? {}) as Record<string, unknown>

  switch (o.action) {
    case 'create': {
      const t = trackerInput(o)
      await createTracker(db, t)
      break
    }
    case 'update': {
      const t = trackerInput(o)
      await updateTracker(db, id(o.trackerId), {
        title: t.title, target: t.target, unit: t.unit, description: t.description,
      })
      break
    }
    case 'archive':
      await archiveTracker(db, id(o.trackerId))
      break
    default:
      throw new BadRequest('Неизвестное действие')
  }
  return listTrackers(db)
}

export async function statsQuery(
  db: Db,
  params: { groupId: number; period: 'week' | 'month'; today: string },
): Promise<GroupReport> {
  const groupId = id(params.groupId)
  const from = params.period === 'month' ? monthStart(params.today) : weekStart(params.today)
  return groupReport(db, groupId, from, params.today)
}
