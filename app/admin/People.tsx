'use client'

import { useState } from 'react'
import type { Bootstrap } from '@/lib/admin.ts'

export default function People(props: {
  data: Bootstrap
  onMembership: (userId: number, groupId: number, on: boolean) => void
  onRename: (userId: number, displayName: string) => void
  onUnlock: (userId: number) => void
}) {
  const { data } = props
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  return (
    <div className="space-y-3">
      {data.users.map((u) => {
        const isNew = u.group_ids.length === 0
        return (
          <section key={u.id} className="rounded-xl border border-black/10 p-3 dark:border-white/15">
            <div className="flex items-center gap-2">
              {editing === u.id ? (
                <>
                  <input
                    className="flex-1 rounded border border-black/20 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                  />
                  <button className="text-sm" onClick={() => { props.onRename(u.id, draft); setEditing(null) }}>
                    Сохранить
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 font-medium">
                    {u.display_name ?? u.first_name ?? `id ${u.id}`}
                    {isNew && <em className="ml-2 rounded bg-amber-200 px-1 text-xs not-italic text-amber-900">новый</em>}
                  </span>
                  <button
                    className="text-sm opacity-60"
                    onClick={() => { setEditing(u.id); setDraft(u.display_name ?? '') }}
                  >
                    ✏️
                  </button>
                </>
              )}
            </div>

            <div className="mt-1 text-xs opacity-60">
              {u.username ? `@${u.username} · ` : ''}{u.id}
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {data.groups.map((g) => {
                const on = u.group_ids.includes(g.id)
                return (
                  <button
                    key={g.id}
                    onClick={() => props.onMembership(u.id, g.id, !on)}
                    className={`rounded-full border px-2 py-1 text-xs ${
                      on ? 'border-transparent bg-blue-600 text-white' : 'border-black/20 opacity-70 dark:border-white/25'
                    }`}
                  >
                    {g.title}
                  </button>
                )
              })}
            </div>

            {u.name_locked && (
              <label className="mt-2 flex items-center gap-2 text-xs opacity-70">
                <input type="checkbox" onChange={() => props.onUnlock(u.id)} />
                разрешить менять имя самому
              </label>
            )}
          </section>
        )
      })}
    </div>
  )
}
