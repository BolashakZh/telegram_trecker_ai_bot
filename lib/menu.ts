import type { InlineKeyboardMarkup } from 'grammy/types'
import type { DayState } from './entries.ts'
import type { Group } from './groups.ts'
import type { GroupReport } from './group-stats.ts'
import type { TrackerStats } from './stats.ts'
import type { Tracker } from './trackers.ts'
import { bar, clip, esc, formatDay, formatRange, num, padRight } from './text.ts'

export function mainScreen(args: {
  day: string
  trackers: Tracker[]
  state: Map<number, DayState>
}): { text: string; keyboard: InlineKeyboardMarkup } {
  const { day, trackers, state } = args

  if (trackers.length === 0) {
    return {
      text: 'Доступ пока не выдан: администратор уже получил уведомление.',
      keyboard: { inline_keyboard: [] },
    }
  }

  const done = trackers.filter((t) => state.get(t.id)?.done).length
  const text = [
    `Сегодня, ${formatDay(day)}`,
    `Выполнено ${done} из ${trackers.length}  ${bar(Math.round((done / trackers.length) * 100), 5)}`,
  ].join('\n')

  const rows = trackers.map((t) => {
    const st = state.get(t.id)
    const mark = st?.done ? '✅' : '⬜️'
    const label = t.kind === 'number'
      ? `${mark} ${t.title} ${num(st?.value ?? 0)}/${num(t.target)}`
      : `${mark} ${t.title}`
    return [{ text: label, callback_data: `t:${t.id}` }]
  })

  rows.push([
    { text: '📈 Моя статистика', callback_data: 's:me' },
    { text: '👥 Группа', callback_data: 's:g' },
    { text: 'ℹ️ Трекеры', callback_data: 's:info' },
  ])

  return { text, keyboard: { inline_keyboard: rows } }
}

// Описание не влезает на кнопку, поэтому живёт на отдельном экране: без него человек
// не понимает, что за «Книга» и сколько именно от него хотят.
export function infoScreen(trackers: Tracker[]): string {
  if (trackers.length === 0) return 'Пока нет трекеров.'

  const lines = trackers.map((t) => {
    const goal = t.kind === 'number' ? ` (цель ${num(t.target)}${t.unit ? ` ${esc(t.unit)}` : ''})` : ''
    return t.description
      ? `• ${esc(t.title)} — ${esc(t.description)}${goal}`
      : `• ${esc(t.title)}${goal}`
  })
  return clip(`Что отмечаем:\n${lines.join('\n')}`)
}

export function statsScreen(stats: TrackerStats[]): string {
  if (stats.length === 0) return 'Пока нет трекеров.'

  const width = Math.max(...stats.map((s) => s.tracker.title.length)) + 1
  const lines: string[] = []
  for (const s of stats) {
    const week = bar(s.expected_week ? (s.done_week / s.expected_week) * 100 : 0)
    const month = s.expected_month ? Math.round((s.done_month / s.expected_month) * 100) : 0
    lines.push(
      `${padRight(s.tracker.title, width)} неделя ${week} ${s.done_week}/${s.expected_week}` +
      `   серия ${s.streak}   месяц ${month}%`,
    )
    if (s.tracker.kind === 'number') {
      const goal = num(s.tracker.target * s.expected_week)
      lines.push(`${' '.repeat(width)} за неделю ${num(s.sum_week)} ${s.tracker.unit ?? ''} (цель ${goal})`)
    }
  }
  // Экранируем контент целиком (числа/бары спецсимволов не содержат — экранирование
  // для них не изменит ничего), потом режем по лимиту с запасом на теги <pre></pre>,
  // и только потом оборачиваем — так закрывающий тег всегда на месте.
  const content = clip(esc(lines.join('\n')), 4096 - '<pre></pre>'.length)
  return `<pre>${content}</pre>`
}

export function groupScreen(
  report: GroupReport,
  viewerId: number,
  missing: { name: string; titles: string[] }[],
): string {
  const width = Math.max(...report.members.map((m) => m.name.length), 6) + 1
  // Каждую строку экранируем после padRight: ширина считается по видимому
  // (неэкранированному) имени, поэтому выравнивание не съезжает, а экранирование
  // применяется к готовой строке целиком (цифры и бар спецсимволов не содержат).
  const rows = report.members.map((m) =>
    esc(`${padRight(m.user_id === viewerId ? 'Вы' : m.name, width)}${bar(m.percent)} ${String(m.percent).padStart(3)}%`),
  )
  const head = `Группа «${esc(report.title)}», неделя ${formatRange(report.from, report.to)}`
  // Хвост растёт линейно по числу пар человек × трекер — режем отдельно от
  // тела <pre>, чтобы обрезка хвоста никогда не задевала закрывающий тег.
  const pre = `<pre>${clip(rows.join('\n'), 2800)}</pre>`
  const tail = missing.length
    ? `\n${clip(`Сегодня не отметились: ${esc(missing.map((m) => `${m.name} — ${m.titles.join(', ')}`).join('; '))}`, 1000)}`
    : '\nСегодня отметились все.'
  return clip(`${head}\n${pre}${tail}`)
}

export function groupsKeyboard(groups: Group[], prefix: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: groups.map((g) => [{ text: g.title, callback_data: `${prefix}${g.id}` }]),
  }
}
