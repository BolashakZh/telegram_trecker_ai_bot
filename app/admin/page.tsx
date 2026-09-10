'use client'

import { useEffect, useState } from 'react'
import type { Bootstrap } from '@/lib/admin.ts'
import { alertUser, api } from './api.ts'
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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.Telegram?.WebApp?.ready()
    window.Telegram?.WebApp?.expand()
    api.bootstrap().then(setData).catch((e: Error) => setError(e.message))
  }, [])

  async function run<T>(action: () => Promise<T>, apply: (res: T) => void) {
    try {
      apply(await action())
    } catch (e) {
      alertUser((e as Error).message)
    }
  }

  if (error) {
    return (
      <main className="p-6 text-center text-sm opacity-70">
        Откройте админку через бота — кнопкой «⚙️ Открыть админку».
      </main>
    )
  }
  if (!data) return <main className="p-6 text-sm opacity-70">Загрузка…</main>

  return (
    <main className="mx-auto max-w-2xl pb-20">
      <div className="p-3">
        {tab === 'people' && (
          <People
            data={data}
            onMembership={(userId, groupId, on) =>
              run(() => api.users({ action: 'membership', userId, groupId, on }),
                  (r) => setData({ ...data, users: r.users }))}
            onRename={(userId, displayName) =>
              run(() => api.users({ action: 'rename', userId, displayName }),
                  (r) => setData({ ...data, users: r.users }))}
            onUnlock={(userId) =>
              run(() => api.users({ action: 'unlockName', userId }),
                  (r) => setData({ ...data, users: r.users }))}
          />
        )}
        {tab === 'groups' && (
          <Groups
            data={data}
            onAction={(body) =>
              run(() => api.groups(body), (r) => setData({ ...data, groups: r.groups, trackers: r.trackers }))}
          />
        )}
        {tab === 'trackers' && (
          <Trackers
            data={data}
            onAction={(body) =>
              run(() => api.trackers(body), (r) => setData({ ...data, trackers: r.trackers }))}
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
