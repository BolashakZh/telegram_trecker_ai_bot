import type { Bootstrap } from '@/lib/admin.ts'
import type { GroupReport } from '@/lib/group-stats.ts'

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData: string; ready(): void; expand(): void; showAlert(m: string): void } }
  }
}

function initData(): string {
  return window.Telegram?.WebApp?.initData ?? ''
}

export function alertUser(message: string): void {
  if (window.Telegram?.WebApp) window.Telegram.WebApp.showAlert(message)
  else window.alert(message)
}

// Несёт код ответа, чтобы вызывающий код мог отличить «нет доступа» (401,
// ожидаемо вне бота) от «сервер сломался» (500 и прочее, ожидаемо чинится
// повтором) — иначе экран ошибки одинаково врёт про «откройте через бота»
// даже когда причина в неподнятой схеме базы.
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Даёт странице шанс дождаться скрипта Telegram, если beforeInteractive по
// какой-то причине не успел (второй рубеж защиты; основной — next/script).
export async function waitForTelegram(timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!window.Telegram?.WebApp) {
    if (Date.now() - start >= timeoutMs) return
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData() },
  })
  const data = await res.json()
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? 'Ошибка запроса', res.status)
  return data as T
}

export const api = {
  bootstrap: () => call<Bootstrap>('/api/admin/bootstrap'),
  users: (body: object) => call<{ users: Bootstrap['users'] }>('/api/admin/users', {
    method: 'POST', body: JSON.stringify(body),
  }),
  groups: (body: object) => call<{ groups: Bootstrap['groups']; trackers: Bootstrap['trackers'] }>(
    '/api/admin/groups', { method: 'POST', body: JSON.stringify(body) },
  ),
  trackers: (body: object) => call<{ trackers: Bootstrap['trackers'] }>('/api/admin/trackers', {
    method: 'POST', body: JSON.stringify(body),
  }),
  stats: (groupId: number, period: 'week' | 'month') =>
    call<GroupReport>(`/api/admin/stats?groupId=${groupId}&period=${period}`),
}
