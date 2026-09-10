'use client'

import { useEffect, useState } from 'react'
import type { Group } from '@/lib/groups.ts'
import type { GroupReport } from '@/lib/group-stats.ts'
import { alertUser, api } from './api.ts'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function cellColor(percent: number): string {
  if (percent >= 100) return 'bg-green-600'
  if (percent >= 50) return 'bg-green-400'
  if (percent > 0) return 'bg-amber-300'
  return 'bg-black/10 dark:bg-white/15'
}

export default function Dashboard({ groups }: { groups: Group[] }) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? 0)
  const [period, setPeriod] = useState<'week' | 'month'>('week')
  const [report, setReport] = useState<GroupReport | null>(null)

  useEffect(() => {
    if (!groupId) return
    api.stats(groupId, period).then(setReport).catch((e: Error) => alertUser(e.message))
  }, [groupId, period])

  if (!groups.length) return <p className="text-sm opacity-70">Сначала создайте группу.</p>

  const days = report ? [...new Set(report.days.map((d) => d.day))].sort() : []

  return (
    <div className="space-y-3 text-sm">
      <div className="flex gap-2">
        <select
          className="rounded border border-black/20 px-2 py-1 dark:border-white/20 dark:bg-transparent"
          value={groupId}
          onChange={(e) => setGroupId(Number(e.target.value))}
        >
          {groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
        </select>
        <select
          className="rounded border border-black/20 px-2 py-1 dark:border-white/20 dark:bg-transparent"
          value={period}
          onChange={(e) => setPeriod(e.target.value as 'week' | 'month')}
        >
          <option value="week">неделя</option>
          <option value="month">месяц</option>
        </select>
        {report && <span className="ml-auto self-center opacity-70">общий {report.percent}%</span>}
      </div>

      {report && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1">
              <thead>
                <tr className="text-xs opacity-60">
                  <th className="text-left">Участник</th>
                  {days.map((d) => (
                    <th key={d} className="w-6">
                      {period === 'week' ? WEEKDAYS[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7] : d.slice(-2)}
                    </th>
                  ))}
                  <th className="w-10">%</th>
                </tr>
              </thead>
              <tbody>
                {report.members.map((m) => (
                  <tr key={m.user_id}>
                    <td className="pr-2 text-xs">{m.name}</td>
                    {days.map((d) => {
                      const cell = report.days.find((x) => x.user_id === m.user_id && x.day === d)
                      return <td key={d}><div className={`h-5 w-5 rounded ${cellColor(cell?.percent ?? 0)}`} /></td>
                    })}
                    <td className="text-right text-xs">{m.percent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-xs opacity-80">
            По трекерам: {report.trackers.map((t) => `${t.title} ${t.percent}%`).join(' · ')}
          </div>
          {report.trackers.filter((t) => t.kind === 'number').map((t) => (
            <div key={t.tracker_id} className="text-xs opacity-80">
              {t.title}: {t.sum} {t.unit ?? ''} за период
            </div>
          ))}
        </>
      )}
    </div>
  )
}
