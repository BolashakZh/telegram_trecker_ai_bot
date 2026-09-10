'use client'

import { useEffect, useState } from 'react'
import type { Bootstrap } from '@/lib/admin.ts'
import { alertUser, api, ApiError, waitForTelegram } from './api.ts'
import Dashboard from './Dashboard.tsx'
import Groups from './Groups.tsx'
import People from './People.tsx'
import Trackers from './Trackers.tsx'

const TABS = [
  { key: 'people', label: '👤 Люди' },
  { key: 'groups', label: '👥 Группы' },
  { key: 'trackers', label: '🎯 Трекеры' },
  { key: 'dash', label: '📊 Дашборд' },
] as const

export default function AdminPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('people')
  const [data, setData] = useState<Bootstrap | null>(null)
  const [error, setError] = useState<{ status?: number; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  function load(): void {
    setError(null)
    waitForTelegram()
      .then(() => {
        window.Telegram?.WebApp?.ready()
        window.Telegram?.WebApp?.expand()
        return api.bootstrap()
      })
      .then(setData)
      .catch((e: Error) => setError({ status: e instanceof ApiError ? e.status : undefined, message: e.message }))
  }

  useEffect(load, [])

  async function run<T>(action: () => Promise<T>, apply: (res: T) => void): Promise<boolean> {
    setBusy(true)
    try {
      apply(await action())
      return true
    } catch (e) {
      alertUser((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    if (error.status === 401) {
      return (
        <main className="min-h-screen bg-white p-6 text-center text-sm text-black/70 dark:bg-black dark:text-white/70">
          Откройте админку через бота — кнопкой «⚙️ Открыть админку».
        </main>
      )
    }
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white p-6 text-center text-sm text-black/70 dark:bg-black dark:text-white/70">
        <p>{error.message}</p>
        <button
          className="rounded bg-blue-600 px-3 py-1 text-white"
          onClick={load}
        >
          Попробовать ещё раз
        </button>
      </main>
    )
  }
  if (!data) {
    return (
      <main className="min-h-screen bg-white p-6 text-sm text-black/70 dark:bg-black dark:text-white/70">
        Загрузка…
      </main>
    )
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-white pb-20 text-black dark:bg-black dark:text-white">
      <div className="p-3">
        {tab === 'people' && (
          <People
            data={data}
            busy={busy}
            onMembership={(userId, groupId, on) =>
              run(() => api.users({ action: 'membership', userId, groupId, on }),
                  (r) => setData((prev) => (prev ? { ...prev, users: r.users } : prev)))}
            onRename={(userId, displayName) =>
              run(() => api.users({ action: 'rename', userId, displayName }),
                  (r) => setData((prev) => (prev ? { ...prev, users: r.users } : prev)))}
            onUnlock={(userId) =>
              run(() => api.users({ action: 'unlockName', userId }),
                  (r) => setData((prev) => (prev ? { ...prev, users: r.users } : prev)))}
          />
        )}
        {tab === 'groups' && (
          <Groups
            data={data}
            busy={busy}
            onAction={(body) =>
              run(() => api.groups(body),
                  (r) => setData((prev) => (prev ? { ...prev, groups: r.groups, trackers: r.trackers } : prev)))}
          />
        )}
        {tab === 'trackers' && (
          <Trackers
            data={data}
            busy={busy}
            onAction={(body) =>
              run(() => api.trackers(body), (r) => setData((prev) => (prev ? { ...prev, trackers: r.trackers } : prev)))}
          />
        )}
        {tab === 'dash' && <Dashboard groups={data.groups} />}
      </div>

      <nav className="fixed inset-x-0 bottom-0 flex border-t border-black/10 bg-white/90 backdrop-blur dark:border-white/10 dark:bg-black/80">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-3 text-xs ${tab === t.key ? 'font-semibold' : 'opacity-60'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </main>
  )
}
