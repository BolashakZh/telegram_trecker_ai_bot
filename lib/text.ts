export type NameParts = {
  id: number
  display_name?: string | null
  first_name?: string | null
  username?: string | null
}

export function personName(u: NameParts): string {
  return u.display_name || u.first_name || (u.username ? `@${u.username}` : `id ${u.id}`)
}

// Экранирование для parse_mode: 'HTML'. Порядок важен: сперва & (иначе &lt;
// превратится в &amp;lt;), потом < и >. Применяется к любому свободному
// тексту, который человек мог ввести сам (имя, название/описание трекера,
// название группы) перед подстановкой в HTML-сообщение бота.
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const MONTHS = ['января','февраля','марта','апреля','мая','июня',
  'июля','августа','сентября','октября','ноября','декабря']
const WEEKDAYS = ['воскресенье','понедельник','вторник','среда','четверг','пятница','суббота']

export function bar(percent: number, width = 7): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

export function formatDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export function formatRange(from: string, to: string): string {
  const a = new Date(`${from}T00:00:00Z`)
  const b = new Date(`${to}T00:00:00Z`)
  if (a.getUTCMonth() === b.getUTCMonth()) {
    return `${a.getUTCDate()}–${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
  }
  return `${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]} – ${b.getUTCDate()} ${MONTHS[b.getUTCMonth()]}`
}

export function num(value: number): string {
  return String(Math.round(value * 100) / 100).replace('.', ',')
}

export function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length)
}

export function clip(text: string, limit = 4096): string {
  if (text.length <= limit) return text
  const lines = text.split('\n')
  const kept: string[] = []
  let size = 0
  for (const line of lines) {
    const tail = `\n…и ещё ${lines.length - kept.length} строк`
    if (size + line.length + 1 + tail.length > limit) break
    kept.push(line)
    size += line.length + 1
  }
  return `${kept.join('\n')}\n…и ещё ${lines.length - kept.length} строк`
}
