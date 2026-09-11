import type { InlineKeyboardMarkup } from 'grammy/types'
import type { Db } from './db.ts'
import { today } from './db.ts'
import { dayState } from './entries.ts'
import { listGroups } from './groups.ts'
import { groupReport, usersWithUnfinished, type GroupReport } from './group-stats.ts'
import { mainScreen } from './menu.ts'
import { weekStart } from './stats.ts'
import { activeTrackersForUser } from './trackers.ts'
import { bar, clip, esc, formatRange, num, padRight } from './text.ts'

export type Sender = {
  send(chatId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<void>
}

export async function claimSend(
  db: Db, kind: 'remind' | 'weekly', key: string,
): Promise<boolean> {
  const rows = await db.q(
    `insert into sent_log (kind, key) values ($1, $2) on conflict do nothing returning key`,
    [kind, key],
  )
  return rows.length > 0
}

export function reminderText(count: number): string {
  return `Бүгінге ${count} трекер қалды. Күн бітпей тұрып белгілеңіз.`
}

export async function sendReminders(db: Db, sender: Sender, today: string): Promise<number> {
  const targets = await usersWithUnfinished(db, today)
  let sent = 0

  for (const { user_id, count } of targets) {
    if (!(await claimSend(db, 'remind', `${today}:${user_id}`))) continue
    try {
      const trackers = await activeTrackersForUser(db, user_id)
      const state = await dayState(db, user_id, today)
      const { keyboard } = mainScreen({ day: today, trackers, state })
      await sender.send(user_id, reminderText(count), keyboard)
      sent += 1
    } catch (err) {
      // Человек заблокировал бота — рассылка остальным продолжается.
      console.error('reminder failed', user_id, err)
    }
  }
  return sent
}

export function accessGrantedText(groupTitle: string, hasTrackers = true): string {
  const head = `Сізге рұқсат берілді — «${esc(groupTitle)}» тобы.`
  // Группу могли создать раньше трекеров: обещать «ваши трекеры» с пустой клавиатурой нельзя.
  return hasTrackers
    ? `${head} Бүгінгі трекерлеріңіз:`
    : `${head} Трекерлерді әкімші қосқан соң, олар осында пайда болады.`
}

export async function sendAccessGranted(
  db: Db, sender: Sender, userId: number, groupTitle: string,
): Promise<void> {
  const day = await today(db)
  const trackers = await activeTrackersForUser(db, userId)
  const state = await dayState(db, userId, day)
  const { keyboard } = mainScreen({ day, trackers, state })
  await sender.send(userId, accessGrantedText(groupTitle, trackers.length > 0), keyboard)
}

export function weeklyText(report: GroupReport): string {
  const width = Math.max(...report.members.map((m) => m.name.length), 6) + 1
  // Как и в groupScreen: ширина считается по неэкранированному имени, строка
  // экранируется целиком после padRight.
  const rows = report.members
    .slice()
    .sort((a, b) => b.percent - a.percent)
    .map((m) => esc(`${padRight(m.name, width)}${bar(m.percent)} ${String(m.percent).padStart(3)}%`))

  const numbers = report.trackers
    .filter((t) => t.kind === 'number' && t.sum > 0)
    .map((t) => `${esc(t.title)}: аптада ${num(t.sum)} ${esc(t.unit ?? '')}`)

  // Тело <pre> режем отдельно от остального: если воскресный отчёт разросся
  // (много участников), обрезка не должна оставить незакрытый тег — это единственная
  // отправка за неделю, вторая попытка при ошибке уже не случится (идемпотентность
  // sent_log). Остальные строки режем отдельным бюджетом, оба всегда укладываются
  // в общий лимит, так что финальный clip — лишь подстраховка снаружи <pre>.
  const pre = `<pre>${clip(rows.join('\n'), 2800)}</pre>`
  const restLines = [
    `Топ бойынша орташа: ${report.percent}%`,
    report.trackers.map((t) => `${esc(t.title)} ${t.percent}%`).join(' · '),
    ...numbers,
  ].filter(Boolean)
  const rest = clip(restLines.join('\n'), 1000)

  return clip([
    `🏁 <b>${esc(report.title)}</b> · ${formatRange(report.from, report.to)} аптасының қорытындысы`,
    pre,
    rest,
  ].filter(Boolean).join('\n'))
}

export async function sendWeekly(db: Db, sender: Sender, today: string): Promise<number> {
  const from = weekStart(today)
  let sent = 0

  for (const group of await listGroups(db)) {
    if (!group.chat_id) {
      console.log(`группа ${group.id} без чата — отчёт пропущен`)
      continue
    }
    if (!(await claimSend(db, 'weekly', `${from}:${group.id}`))) continue
    try {
      const report = await groupReport(db, group.id, from, today)
      if (report.members.length === 0) continue
      await sender.send(group.chat_id, weeklyText(report))
      sent += 1
    } catch (err) {
      console.error('weekly failed', group.id, err)
    }
  }
  return sent
}
