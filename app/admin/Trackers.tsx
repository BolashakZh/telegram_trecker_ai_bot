'use client'

import { useState } from 'react'
import type { Bootstrap } from '@/lib/admin.ts'

export default function Trackers(props: { data: Bootstrap; busy: boolean; onAction: (body: object) => Promise<boolean> }) {
  const { data, busy } = props
  const [form, setForm] = useState({
    title: '', description: '', kind: 'check' as 'check' | 'number', target: '10', unit: '',
  })

  const groupTitle = (id: number) => data.groups.find((g) => g.id === id)?.title ?? `#${id}`

  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-xl border border-black/10 p-3 dark:border-white/15">
        <input
          className="w-full rounded border border-black/20 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          placeholder="Название на кнопку, например «Книга»"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <input
          className="w-full rounded border border-black/20 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          placeholder="Описание: читаем про психологию, 10 стр. в день"
          maxLength={200}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <div className="flex flex-wrap gap-2 text-sm">
          <select
            className="rounded border border-black/20 px-2 py-1 dark:border-white/20 dark:bg-transparent"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as 'check' | 'number' })}
          >
            <option value="check">галочка</option>
            <option value="number">число</option>
          </select>
          {form.kind === 'number' && (
            <>
              <input
                className="w-20 rounded border border-black/20 px-2 py-1 dark:border-white/20 dark:bg-transparent"
                value={form.target}
                onChange={(e) => setForm({ ...form, target: e.target.value })}
                placeholder="цель"
              />
              <input
                className="w-24 rounded border border-black/20 px-2 py-1 dark:border-white/20 dark:bg-transparent"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="стр."
              />
            </>
          )}
          <button
            className="ml-auto rounded bg-blue-600 px-3 text-white disabled:opacity-60 disabled:cursor-progress"
            disabled={busy}
            onClick={async () => {
              const ok = await props.onAction({
                action: 'create', title: form.title, description: form.description,
                kind: form.kind, target: Number(form.target), unit: form.unit,
              })
              if (ok) setForm({ title: '', description: '', kind: 'check', target: '10', unit: '' })
            }}
          >
            Создать
          </button>
        </div>
      </section>

      {data.trackers.map((t) => (
        <section key={t.id} className="rounded-xl border border-black/10 p-3 text-sm dark:border-white/15">
          <div className="flex items-center justify-between">
            <b>{t.title}</b>
            <button
              className="text-xs opacity-60 disabled:opacity-30 disabled:cursor-progress"
              disabled={busy}
              onClick={() => props.onAction({ action: 'archive', trackerId: t.id })}
            >
              архивировать
            </button>
          </div>
          {t.description && <div className="mt-1 text-xs opacity-80">{t.description}</div>}
          <div className="mt-1 text-xs opacity-70">
            {t.kind === 'number' ? `число, цель ${t.target} ${t.unit ?? ''}` : 'галочка'}
            {' · '}
            {t.group_ids.length ? `в группах: ${t.group_ids.map(groupTitle).join(', ')}` : 'не привязан ни к одной группе'}
          </div>
        </section>
      ))}
    </div>
  )
}
