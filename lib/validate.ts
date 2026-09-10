export class BadRequest extends Error {}

export function title(raw: unknown): string {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (s.length < 1 || s.length > 60) throw new BadRequest('Название: от 1 до 60 символов')
  return s
}

export function id(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) throw new BadRequest('Некорректный идентификатор')
  return n
}

export function flag(raw: unknown): boolean {
  if (typeof raw !== 'boolean') throw new BadRequest('Ожидался true или false')
  return raw
}

export function description(raw: unknown): string | null {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!s) return null
  if (s.length > 200) throw new BadRequest('Описание: не больше 200 символов')
  return s
}

export function trackerInput(raw: unknown): {
  title: string; kind: 'check' | 'number'; target: number; unit: string | null
  description: string | null
} {
  const o = (raw ?? {}) as Record<string, unknown>
  const kind = o.kind
  if (kind !== 'check' && kind !== 'number') throw new BadRequest('Тип: галочка или число')
  const about = description(o.description)

  if (kind === 'check') {
    return { title: title(o.title), kind, target: 1, unit: null, description: about }
  }

  const target = Number(o.target)
  if (!Number.isFinite(target) || target <= 0) throw new BadRequest('Цель должна быть больше нуля')
  const unit = String(o.unit ?? '').trim()
  if (!unit) throw new BadRequest('Укажите единицу измерения, например «стр.»')
  return { title: title(o.title), kind, target, unit, description: about }
}
