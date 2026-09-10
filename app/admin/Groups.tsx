'use client'

import { useState } from 'react'
import type { Bootstrap } from '@/lib/admin.ts'

export default function Groups(props: {
  data: Bootstrap
  busy: boolean
  onAction: (body: object) => Promise<boolean>
}) {
  const { data, busy } = props
  const [title, setTitle] = useState('')

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-black/20 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          placeholder="Новая группа"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button
          className="rounded bg-blue-600 px-3 text-sm text-white disabled:opacity-60 disabled:cursor-progress"
          disabled={busy}
          onClick={async () => {
            const ok = await props.onAction({ action: 'create', title })
            if (ok) setTitle('')
          }}
        >
          Создать
        </button>
      </div>

      {data.groups.map((g) => {
        const members = data.users.filter((u) => u.group_ids.includes(g.id))
        return (
          <section key={g.id} className="rounded-xl border border-black/10 p-3 dark:border-white/15">
            <div className="flex items-center justify-between">
              <b>{g.title}</b>
              <button
                className="text-xs opacity-60 disabled:opacity-30 disabled:cursor-progress"
                disabled={busy}
                onClick={() => props.onAction({ action: 'archive', groupId: g.id })}
              >
                архивировать
              </button>
            </div>

            <div className="mt-1 text-xs opacity-70">
              {g.chat_id
                ? <>Чат привязан · <button
                    disabled={busy}
                    className="disabled:opacity-60 disabled:cursor-progress"
                    onClick={() => props.onAction({ action: 'unbindChat', groupId: g.id })}
                  >отвязать</button></>
                : 'Чат не привязан — напишите /bind в чате группы'}
              {' · '}участников: {members.length}
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {data.trackers.map((t) => {
                const on = t.group_ids.includes(g.id)
                return (
                  <button
                    key={t.id}
                    disabled={busy}
                    onClick={() => props.onAction({ action: 'tracker', groupId: g.id, trackerId: t.id, on: !on })}
                    className={`rounded-full border px-2 py-1 text-xs disabled:opacity-60 disabled:cursor-progress ${
                      on ? 'border-transparent bg-green-600 text-white' : 'border-black/20 opacity-70 dark:border-white/25'
                    }`}
                  >
                    {t.title}
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
