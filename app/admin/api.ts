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

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Init-Data': initData() },
  })
  const data = await res.json()
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Ошибка запроса')
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
