# Telegram Habit Tracker v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram-бот, где участники нескольких групп отмечают ежедневные трекеры (галочка или число), получают вечернее напоминание и воскресный отчёт в чат группы, а админ управляет группами, трекерами и людьми в Mini App.

**Architecture:** Один Next.js-проект (App Router, TypeScript). Роуты — тонкие обёртки: вебхук Telegram, два cron-роута, пять админских ручек, страница Mini App. Вся доменная логика в `lib/` и не зависит от Next, Telegram и Vercel, поэтому тестируется в vitest на PGlite через один интерфейс `db.q(text, params) → rows`; в проде тот же интерфейс даёт HTTP-драйвер Neon.

**Tech Stack:** Node.js ≥ 22, Next.js (App Router) + React + TypeScript, Tailwind CSS v4, grammY, `@neondatabase/serverless`; тесты — vitest + `@electric-sql/pglite`.

**Spec:** `docs/superpowers/specs/2026-09-10-telegram-habit-tracker-design.md`

## Global Constraints

- TypeScript везде: `lib/`, роуты, страницы. Никакого JS-кода, кроме конфигов, которым это положено.
- Прод-зависимости ровно четыре: `next`, `react`, `react-dom`, `grammy`, `@neondatabase/serverless`. Dev: `typescript`, `@types/*`, `vitest`, `@electric-sql/pglite`, `tailwindcss`, `@tailwindcss/postcss`. Никаких ORM, zod, dayjs, chart-библиотек, SDK-обёрток над Telegram WebApp.
- `lib/**` не импортирует `next/*`, `next/server`, `react` и не читает `process.env` напрямую (кроме `lib/config.ts`). Всё, что нужно, приходит аргументами. Это условие проверяемо и оно — причина, по которой тесты не требуют ни сети, ни секретов.
- Слой данных — только `db.q(text, params)`. Даты пересекают границу SQL ↔ TS **только строками** `YYYY-MM-DD`: наружу `::date::text`, внутрь `$n::date`. Никаких `Date` в SQL-слое.
- Все агрегаты кастуются явно: `count(*)::int`, `sum(...)::float8`, `target::float8` — иначе Postgres отдаёт `numeric` строкой.
- «Сегодня» вычисляется в SQL: `(now() at time zone $1)::date`. Все доменные функции принимают `today` параметром, чтобы тесты фиксировали дату.
- Тексты бота и админки — на русском.
- Callback data: `t:<tracker_id>` — тап по трекеру, `s:me` — статистика, `s:g:<group_id>` — сводка группы, `b:<group_id>` — привязка чата в `/bind`.
- Вебхук всегда отвечает 200 после проверки секрета, даже при исключении.
- Тесты пишутся до кода. Коммит после каждой задачи, сообщения `feat:` / `test:` / `chore:`, в конце сообщения:

  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01UtJqSxvNfwUFN6AsSEBgQt
  ```

## File Structure

| Файл | Ответственность |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts` | Проект и тесты |
| `app/layout.tsx`, `app/globals.css` | Обвязка Next и Tailwind |
| `lib/config.ts` | Единственное место, где читается `process.env` |
| `lib/db.ts` | `Db`, `createDb`, `neonDb`, `migrate`, `today` |
| `lib/users.ts` | Регистрация из апдейта, имя, `name_locked`, список людей |
| `lib/groups.ts` | Группы, чат группы, членства |
| `lib/trackers.ts` | Каталог трекеров, связь с группами, активные трекеры человека |
| `lib/entries.ts` | Тоггл галочки, запись числа, состояние дня, `pending_input`, `claimUpdate` |
| `lib/stats.ts` | Личная статистика (процент, серия, пропуски, суммы) |
| `lib/group-stats.ts` | Групповая статистика: участники, трекеры, карта дней, «не отметились» |
| `lib/text.ts` | `personName`, дата по-русски, бары, моноширинные таблицы, обрезка |
| `lib/menu.ts` | Клавиатуры и тексты экранов бота |
| `lib/report.ts` | Тексты напоминания и воскресного отчёта, `claimSend` |
| `lib/validate.ts` | Валидация входа админских ручек |
| `lib/auth.ts` | Проверка `initData`, `requireAdmin` |
| `lib/bot.ts`, `lib/handlers/user.ts`, `lib/handlers/admin.ts` | Сборка бота и обработчики |
| `app/api/telegram/route.ts`, `app/api/setup/route.ts` | Вебхук и установка |
| `app/api/cron/reminder/route.ts`, `app/api/cron/weekly/route.ts` | Расписания |
| `app/api/admin/*/route.ts` | Bootstrap, люди, группы, трекеры, статистика |
| `app/admin/page.tsx`, `app/admin/*.tsx` | Mini App |
| `scripts/dev-bot.ts` | Локальный запуск бота на long polling |
| `tests/helpers.ts` | PGlite-подложка и фикстуры |

---

### Task 1: Скелет проекта, слой данных и миграции

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore` (дополнить), `app/layout.tsx`, `app/globals.css`, `lib/config.ts`, `lib/db.ts`, `tests/helpers.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `type Row = Record<string, unknown>`
  - `type Db = { q(text: string, params?: unknown[]): Promise<Row[]>; tz: string }`
  - `createDb(q, tz): Db`, `neonDb(url: string, tz: string): Db`
  - `migrate(db: Db): Promise<void>`, `today(db: Db): Promise<string>` (`'YYYY-MM-DD'`)
  - `dayAt(db: Db, iso: string): Promise<string>` — дата в `db.tz` для конкретного момента; нужен тестам границы суток
  - `tests/helpers.ts`: `testDb(tz?: string): Promise<Db>`

- [ ] **Step 1: Создать `package.json`**

```json
{
  "name": "trecker-bot",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest",
    "bot": "node --env-file=.env --experimental-strip-types scripts/dev-bot.ts"
  },
  "dependencies": {
    "@neondatabase/serverless": "^1.1.0",
    "grammy": "^1.46.0",
    "next": "latest",
    "react": "latest",
    "react-dom": "latest"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.8",
    "@tailwindcss/postcss": "latest",
    "@types/node": "latest",
    "@types/react": "latest",
    "tailwindcss": "latest",
    "typescript": "latest",
    "vitest": "^5.0.0"
  }
}
```

Затем `npm install`. После установки заменить `"latest"` на конкретные версии, которые встали (`npm pkg get dependencies`), чтобы сборка была воспроизводимой.

- [ ] **Step 2: Конфиги**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "jsx": "preserve",
    "incremental": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "paths": { "@/*": ["./*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:

```ts
import type { NextConfig } from 'next'

const config: NextConfig = {}
export default config
```

`postcss.config.mjs`:

```js
export default { plugins: { '@tailwindcss/postcss': {} } }
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
```

`app/globals.css`:

```css
@import "tailwindcss";
```

`app/layout.tsx`:

```tsx
import './globals.css'

export const metadata = { title: 'Трекер привычек' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
```

В `.gitignore` добавить строки `.next/`, `next-env.d.ts`, `coverage/`.

- [ ] **Step 3: Написать падающий тест `tests/db.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { dayAt, migrate, today } from '../lib/db.ts'
import { testDb } from './helpers.ts'

describe('migrate', () => {
  it('создаёт все таблицы и повторный вызов не падает', async () => {
    const db = await testDb()
    await migrate(db)

    const rows = await db.q(
      `select table_name from information_schema.tables
       where table_schema = 'public' order by table_name`,
    )
    expect(rows.map((r) => r.table_name)).toEqual([
      'entries', 'group_trackers', 'groups', 'memberships',
      'pending_input', 'processed', 'sent_log', 'trackers', 'users',
    ])
  })
})

describe('today / dayAt', () => {
  it('возвращает дату в часовом поясе базы данных', async () => {
    const db = await testDb('Asia/Almaty')
    // 2026-09-10 19:30 UTC = 2026-09-11 00:30 в Алматы (UTC+5)
    expect(await dayAt(db, '2026-09-10T19:30:00Z')).toBe('2026-09-11')
    expect(await dayAt(db, '2026-09-10T18:30:00Z')).toBe('2026-09-10')
  })

  it('today отдаёт строку YYYY-MM-DD', async () => {
    const db = await testDb()
    expect(await today(db)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
```

`tests/helpers.ts`:

```ts
import { PGlite } from '@electric-sql/pglite'
import { createDb, migrate, type Db } from '../lib/db.ts'

export async function testDb(tz = 'Asia/Almaty'): Promise<Db> {
  const pg = new PGlite()
  const db = createDb(async (text, params = []) => {
    const res = await pg.query(text, params as unknown[])
    return res.rows as Record<string, unknown>[]
  }, tz)
  await migrate(db)
  return db
}
```

- [ ] **Step 4: Запустить тест и убедиться, что он падает**

Run: `npm test -- tests/db.test.ts`
Expected: FAIL — модуль `lib/db.ts` не найден.

- [ ] **Step 5: Написать `lib/config.ts`**

```ts
function req(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Не задана переменная окружения ${name}`)
  return v
}

export const config = {
  botToken: () => req('BOT_TOKEN'),
  databaseUrl: () => req('DATABASE_URL'),
  tz: () => process.env.TZ || 'Asia/Almaty',
  adminIds: () =>
    (process.env.ADMIN_IDS ?? '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
  webhookSecret: () => req('WEBHOOK_SECRET'),
  setupSecret: () => req('SETUP_SECRET'),
  cronSecret: () => req('CRON_SECRET'),
  appUrl: () => req('APP_URL').replace(/\/$/, ''),
  devAdminId: () =>
    process.env.NODE_ENV === 'production' ? 0 : Number(process.env.DEV_ADMIN_ID ?? 0),
}
```

- [ ] **Step 6: Написать `lib/db.ts`**

```ts
import { neon } from '@neondatabase/serverless'

export type Row = Record<string, unknown>
export type Query = (text: string, params?: unknown[]) => Promise<Row[]>
export type Db = { q: Query; tz: string }

export function createDb(q: Query, tz: string): Db {
  return { q, tz }
}

export function neonDb(url: string, tz: string): Db {
  const sql = neon(url)
  const q: Query = async (text, params = []) => {
    try {
      return (await sql.query(text, params)) as Row[]
    } catch (err) {
      // Neon засыпает после простоя: один повтор перед тем, как сдаться.
      if (!isConnectionError(err)) throw err
      return (await sql.query(text, params)) as Row[]
    }
  }
  return createDb(q, tz)
}

function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /fetch failed|ECONNRESET|ETIMEDOUT|connection|timeout/i.test(msg)
}

const SCHEMA = `
create table if not exists users (
  id           bigint primary key,
  username     text,
  first_name   text,
  display_name text,
  name_locked  boolean not null default false,
  created_at   timestamptz not null default now()
);
create table if not exists groups (
  id          serial primary key,
  title       text not null,
  chat_id     bigint unique,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create table if not exists trackers (
  id          serial primary key,
  title       text not null,
  kind        text not null check (kind in ('check','number')),
  target      numeric not null default 1 check (target > 0),
  unit        text,
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);
create table if not exists group_trackers (
  group_id   int not null references groups(id),
  tracker_id int not null references trackers(id),
  linked_at  timestamptz not null default now(),
  primary key (group_id, tracker_id)
);
create table if not exists memberships (
  user_id   bigint not null references users(id),
  group_id  int not null references groups(id),
  joined_at timestamptz not null default now(),
  primary key (user_id, group_id)
);
create table if not exists entries (
  user_id    bigint not null references users(id),
  tracker_id int not null references trackers(id),
  day        date not null,
  value      numeric not null default 1,
  created_at timestamptz not null default now(),
  primary key (user_id, tracker_id, day)
);
create table if not exists pending_input (
  user_id    bigint primary key references users(id),
  tracker_id int not null references trackers(id),
  at         timestamptz not null default now()
);
create table if not exists processed (
  update_id bigint primary key,
  at        timestamptz not null default now()
);
create table if not exists sent_log (
  kind text not null,
  key  text not null,
  at   timestamptz not null default now(),
  primary key (kind, key)
);
create index if not exists entries_day_idx on entries (day);
create index if not exists memberships_group_idx on memberships (group_id);
`

export async function migrate(db: Db): Promise<void> {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.q(stmt)
  }
}

export async function today(db: Db): Promise<string> {
  const [row] = await db.q(`select (now() at time zone $1)::date::text as day`, [db.tz])
  return row.day as string
}

export async function dayAt(db: Db, iso: string): Promise<string> {
  const [row] = await db.q(
    `select ($1::timestamptz at time zone $2)::date::text as day`,
    [iso, db.tz],
  )
  return row.day as string
}
```

Замечание для реализующего: `migrate` гоняет запросы по одному, потому что HTTP-драйвер Neon не выполняет несколько операторов в одном запросе. Именно поэтому в `SCHEMA` нет ни одного `;` внутри выражений.

- [ ] **Step 7: Запустить тест и убедиться, что он проходит**

Run: `npm test -- tests/db.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 8: Коммит**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs vitest.config.ts .gitignore app lib tests
git commit -m "feat: project skeleton, db layer and migrations"
```

---

### Task 2: Люди и имена

**Files:**
- Create: `lib/users.ts`, `lib/text.ts`
- Test: `tests/users.test.ts`

**Interfaces:**
- Consumes: `Db` из `lib/db.ts`, `testDb` из `tests/helpers.ts`.
- Produces:
  - `type User = { id: number; username: string | null; first_name: string | null; display_name: string | null; name_locked: boolean }`
  - `upsertFromTelegram(db, tg: { id: number; username?: string; first_name?: string }): Promise<User>`
  - `getUser(db, id: number): Promise<User | null>`
  - `normalizeName(raw: string): string | null`
  - `setDisplayName(db, id: number, raw: string, opts: { byAdmin: boolean }): Promise<{ ok: true; name: string } | { ok: false; reason: 'locked' | 'invalid' }>`
  - `unlockName(db, id: number): Promise<void>`
  - `listUsers(db): Promise<(User & { group_ids: number[] })[]>`
  - `personName(u: Partial<User> & { id: number }): string` (в `lib/text.ts`)

- [ ] **Step 1: Написать падающий тест `tests/users.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { getUser, normalizeName, setDisplayName, unlockName, upsertFromTelegram } from '../lib/users.ts'
import { personName } from '../lib/text.ts'
import { testDb } from './helpers.ts'

describe('normalizeName', () => {
  it('чистит пробелы и принимает нормальное имя', () => {
    expect(normalizeName('  Айгуль   Смагулова ')).toBe('Айгуль Смагулова')
  })

  it('отвергает мусор', () => {
    expect(normalizeName('a')).toBeNull()
    expect(normalizeName('   ')).toBeNull()
    expect(normalizeName('123')).toBeNull()
    expect(normalizeName('🙂🙂')).toBeNull()
    expect(normalizeName('x'.repeat(41))).toBeNull()
  })
})

describe('upsertFromTelegram', () => {
  it('создаёт человека без имени и обновляет данные Telegram при следующем апдейте', async () => {
    const db = await testDb()
    const first = await upsertFromTelegram(db, { id: 7, username: 'spider', first_name: 'Человек-паук' })
    expect(first.display_name).toBeNull()

    const second = await upsertFromTelegram(db, { id: 7, username: 'newnick', first_name: 'Человек-паук' })
    expect(second.username).toBe('newnick')
    expect(second.display_name).toBeNull()
  })
})

describe('setDisplayName', () => {
  it('участник задаёт имя сам', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Ч' })
    const res = await setDisplayName(db, 7, 'Айгуль Смагулова', { byAdmin: false })
    expect(res).toEqual({ ok: true, name: 'Айгуль Смагулова' })
    expect((await getUser(db, 7))?.display_name).toBe('Айгуль Смагулова')
  })

  it('правка админом блокирует самостоятельную смену, unlockName снимает замок', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Ч' })
    await setDisplayName(db, 7, 'Данияр Ахметов', { byAdmin: true })
    expect((await getUser(db, 7))?.name_locked).toBe(true)

    expect(await setDisplayName(db, 7, 'Человек-паук', { byAdmin: false })).toEqual({
      ok: false, reason: 'locked',
    })
    expect((await getUser(db, 7))?.display_name).toBe('Данияр Ахметов')

    await unlockName(db, 7)
    expect(await setDisplayName(db, 7, 'Данияр А', { byAdmin: false })).toEqual({
      ok: true, name: 'Данияр А',
    })
  })

  it('невалидное имя не записывается', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7 })
    expect(await setDisplayName(db, 7, '!!', { byAdmin: false })).toEqual({
      ok: false, reason: 'invalid',
    })
  })
})

describe('personName', () => {
  it('падает по цепочке display_name → first_name → @username → id', () => {
    expect(personName({ id: 7, display_name: 'Айгуль' })).toBe('Айгуль')
    expect(personName({ id: 7, first_name: 'Айгуль', display_name: null })).toBe('Айгуль')
    expect(personName({ id: 7, username: 'aigul', display_name: null, first_name: null })).toBe('@aigul')
    expect(personName({ id: 7 })).toBe('id 7')
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm test -- tests/users.test.ts`
Expected: FAIL — нет `lib/users.ts`.

- [ ] **Step 3: Написать `lib/text.ts` (пока только `personName`)**

```ts
export type NameParts = {
  id: number
  display_name?: string | null
  first_name?: string | null
  username?: string | null
}

export function personName(u: NameParts): string {
  return u.display_name || u.first_name || (u.username ? `@${u.username}` : `id ${u.id}`)
}
```

- [ ] **Step 4: Написать `lib/users.ts`**

```ts
import type { Db } from './db.ts'

export type User = {
  id: number
  username: string | null
  first_name: string | null
  display_name: string | null
  name_locked: boolean
}

const COLS = `id::int8 as id, username, first_name, display_name, name_locked`

function toUser(row: Record<string, unknown>): User {
  return {
    id: Number(row.id),
    username: (row.username as string) ?? null,
    first_name: (row.first_name as string) ?? null,
    display_name: (row.display_name as string) ?? null,
    name_locked: Boolean(row.name_locked),
  }
}

export async function upsertFromTelegram(
  db: Db,
  tg: { id: number; username?: string; first_name?: string },
): Promise<User> {
  const [row] = await db.q(
    `insert into users (id, username, first_name) values ($1, $2, $3)
     on conflict (id) do update set username = excluded.username,
                                    first_name = excluded.first_name
     returning ${COLS}`,
    [tg.id, tg.username ?? null, tg.first_name ?? null],
  )
  return toUser(row)
}

export async function getUser(db: Db, id: number): Promise<User | null> {
  const [row] = await db.q(`select ${COLS} from users where id = $1`, [id])
  return row ? toUser(row) : null
}

export function normalizeName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 40) return null
  if (!/\p{L}/u.test(name)) return null
  return name
}

export async function setDisplayName(
  db: Db,
  id: number,
  raw: string,
  opts: { byAdmin: boolean },
): Promise<{ ok: true; name: string } | { ok: false; reason: 'locked' | 'invalid' }> {
  const name = normalizeName(raw)
  if (!name) return { ok: false, reason: 'invalid' }

  if (!opts.byAdmin) {
    const current = await getUser(db, id)
    if (current?.name_locked) return { ok: false, reason: 'locked' }
  }

  await db.q(
    `update users set display_name = $2, name_locked = name_locked or $3 where id = $1`,
    [id, name, opts.byAdmin],
  )
  return { ok: true, name }
}

export async function unlockName(db: Db, id: number): Promise<void> {
  await db.q(`update users set name_locked = false where id = $1`, [id])
}

export async function listUsers(db: Db): Promise<(User & { group_ids: number[] })[]> {
  const rows = await db.q(
    `select ${COLS},
            coalesce(array_agg(m.group_id order by m.group_id)
                     filter (where m.group_id is not null), '{}') as group_ids
     from users u left join memberships m on m.user_id = u.id
     group by u.id
     order by (count(m.group_id) = 0) desc, coalesce(u.display_name, u.first_name, '')`,
    [],
  )
  return rows.map((r) => ({ ...toUser(r), group_ids: (r.group_ids as number[]).map(Number) }))
}
```

Замечание: в `listUsers` алиас `u` обязателен — `${COLS}` ссылается на колонки `users`; при написании подставьте `u.` перед каждой (`u.id::int8 as id, u.username, …`), иначе Postgres не разберёт `group by u.id`.

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `npm test -- tests/users.test.ts`
Expected: PASS.

- [ ] **Step 6: Коммит**

```bash
git add lib/users.ts lib/text.ts tests/users.test.ts
git commit -m "feat: users, display names and name lock"
```

---

### Task 3: Группы, каталог трекеров и связки

**Files:**
- Create: `lib/groups.ts`, `lib/trackers.ts`
- Test: `tests/groups.test.ts`, `tests/trackers.test.ts`

**Interfaces:**
- Consumes: `Db`, `upsertFromTelegram`.
- Produces (`lib/groups.ts`):
  - `type Group = { id: number; title: string; chat_id: number | null; archived_at: string | null }`
  - `createGroup(db, title): Promise<Group>`, `renameGroup(db, id, title)`, `archiveGroup(db, id)`
  - `bindChat(db, groupId, chatId): Promise<void>` (переносит чат, если он был у другой группы), `unbindChat(db, groupId)`
  - `listGroups(db, opts?: { includeArchived?: boolean }): Promise<Group[]>`
  - `setMembership(db, userId, groupId, on: boolean): Promise<void>`
  - `userGroups(db, userId): Promise<Group[]>`, `groupMembers(db, groupId): Promise<User[]>`
- Produces (`lib/trackers.ts`):
  - `type Tracker = { id: number; title: string; kind: 'check' | 'number'; target: number; unit: string | null; archived_at: string | null }`
  - `createTracker(db, t: { title; kind; target?; unit? }): Promise<Tracker>`, `updateTracker`, `archiveTracker`
  - `listTrackers(db, opts?): Promise<(Tracker & { group_ids: number[] })[]>`
  - `setGroupTracker(db, groupId, trackerId, on: boolean): Promise<void>`
  - `activeTrackersForUser(db, userId): Promise<Tracker[]>` — дедуплицированные, порядок по `id`
  - `groupTrackers(db, groupId): Promise<Tracker[]>`

- [ ] **Step 1: Написать падающий тест `tests/trackers.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { createGroup, setMembership } from '../lib/groups.ts'
import {
  activeTrackersForUser, archiveTracker, createTracker, listTrackers, setGroupTracker,
} from '../lib/trackers.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { testDb } from './helpers.ts'

describe('activeTrackersForUser', () => {
  it('трекер в двух группах человека показан один раз', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'А' })
    const morning = await createGroup(db, 'Утро')
    const sport = await createGroup(db, 'Спорт')
    const reading = await createTracker(db, { title: 'Чтение', kind: 'check' })

    await setGroupTracker(db, morning.id, reading.id, true)
    await setGroupTracker(db, sport.id, reading.id, true)
    await setMembership(db, 7, morning.id, true)
    await setMembership(db, 7, sport.id, true)

    const list = await activeTrackersForUser(db, 7)
    expect(list.map((t) => t.title)).toEqual(['Чтение'])
  })

  it('не показывает архивные трекеры и трекеры чужих групп', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'А' })
    const mine = await createGroup(db, 'Моя')
    const alien = await createGroup(db, 'Чужая')
    const live = await createTracker(db, { title: 'Зарядка', kind: 'check' })
    const dead = await createTracker(db, { title: 'Старое', kind: 'check' })
    const alienTracker = await createTracker(db, { title: 'Чужое', kind: 'check' })

    await setGroupTracker(db, mine.id, live.id, true)
    await setGroupTracker(db, mine.id, dead.id, true)
    await setGroupTracker(db, alien.id, alienTracker.id, true)
    await setMembership(db, 7, mine.id, true)
    await archiveTracker(db, dead.id)

    expect((await activeTrackersForUser(db, 7)).map((t) => t.title)).toEqual(['Зарядка'])
  })

  it('числовой трекер отдаёт цель числом, а не строкой', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7 })
    const g = await createGroup(db, 'Утро')
    const pages = await createTracker(db, { title: 'Страницы', kind: 'number', target: 10, unit: 'стр.' })
    await setGroupTracker(db, g.id, pages.id, true)
    await setMembership(db, 7, g.id, true)

    const [t] = await activeTrackersForUser(db, 7)
    expect(t.target).toBe(10)
    expect(typeof t.target).toBe('number')
    expect(t.unit).toBe('стр.')
  })
})

describe('listTrackers', () => {
  it('показывает, в каких группах используется трекер', async () => {
    const db = await testDb()
    const a = await createGroup(db, 'A')
    const b = await createGroup(db, 'B')
    const reading = await createTracker(db, { title: 'Чтение', kind: 'check' })
    await setGroupTracker(db, a.id, reading.id, true)
    await setGroupTracker(db, b.id, reading.id, true)

    const [row] = await listTrackers(db)
    expect(row.group_ids).toEqual([a.id, b.id])
  })
})
```

- [ ] **Step 2: Написать падающий тест `tests/groups.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { bindChat, createGroup, groupMembers, listGroups, setMembership, userGroups } from '../lib/groups.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { testDb } from './helpers.ts'

describe('membership', () => {
  it('включается и выключается, повторный вызов идемпотентен', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Айгуль' })
    const g = await createGroup(db, 'Утро')

    await setMembership(db, 7, g.id, true)
    await setMembership(db, 7, g.id, true)
    expect((await userGroups(db, 7)).map((x) => x.title)).toEqual(['Утро'])
    expect((await groupMembers(db, g.id)).map((u) => u.id)).toEqual([7])

    await setMembership(db, 7, g.id, false)
    expect(await userGroups(db, 7)).toEqual([])
  })
})

describe('bindChat', () => {
  it('привязывает чат и переносит его с другой группы', async () => {
    const db = await testDb()
    const a = await createGroup(db, 'A')
    const b = await createGroup(db, 'B')

    await bindChat(db, a.id, -100500)
    await bindChat(db, b.id, -100500)

    const groups = await listGroups(db)
    expect(groups.find((g) => g.id === a.id)?.chat_id).toBeNull()
    expect(groups.find((g) => g.id === b.id)?.chat_id).toBe(-100500)
  })
})
```

- [ ] **Step 3: Запустить оба теста и убедиться, что они падают**

Run: `npm test -- tests/groups.test.ts tests/trackers.test.ts`
Expected: FAIL — нет `lib/groups.ts` и `lib/trackers.ts`.

- [ ] **Step 4: Написать `lib/groups.ts`**

```ts
import type { Db } from './db.ts'
import type { User } from './users.ts'

export type Group = {
  id: number
  title: string
  chat_id: number | null
  archived_at: string | null
}

const COLS = `id, title, chat_id::int8 as chat_id, archived_at::text as archived_at`

function toGroup(row: Record<string, unknown>): Group {
  return {
    id: Number(row.id),
    title: row.title as string,
    chat_id: row.chat_id == null ? null : Number(row.chat_id),
    archived_at: (row.archived_at as string) ?? null,
  }
}

export async function createGroup(db: Db, title: string): Promise<Group> {
  const [row] = await db.q(`insert into groups (title) values ($1) returning ${COLS}`, [title])
  return toGroup(row)
}

export async function renameGroup(db: Db, id: number, title: string): Promise<void> {
  await db.q(`update groups set title = $2 where id = $1`, [id, title])
}

export async function archiveGroup(db: Db, id: number): Promise<void> {
  await db.q(`update groups set archived_at = now() where id = $1`, [id])
}

export async function bindChat(db: Db, groupId: number, chatId: number): Promise<void> {
  // chat_id уникален: сначала снимаем его со старой группы, иначе вставка упадёт.
  await db.q(`update groups set chat_id = null where chat_id = $1`, [chatId])
  await db.q(`update groups set chat_id = $2 where id = $1`, [groupId, chatId])
}

export async function unbindChat(db: Db, groupId: number): Promise<void> {
  await db.q(`update groups set chat_id = null where id = $1`, [groupId])
}

export async function listGroups(
  db: Db,
  opts: { includeArchived?: boolean } = {},
): Promise<Group[]> {
  const where = opts.includeArchived ? '' : 'where archived_at is null'
  const rows = await db.q(`select ${COLS} from groups ${where} order by id`)
  return rows.map(toGroup)
}

export async function setMembership(
  db: Db, userId: number, groupId: number, on: boolean,
): Promise<void> {
  if (on) {
    await db.q(
      `insert into memberships (user_id, group_id) values ($1, $2)
       on conflict do nothing`,
      [userId, groupId],
    )
  } else {
    await db.q(`delete from memberships where user_id = $1 and group_id = $2`, [userId, groupId])
  }
}

export async function userGroups(db: Db, userId: number): Promise<Group[]> {
  const rows = await db.q(
    `select g.id, g.title, g.chat_id::int8 as chat_id, g.archived_at::text as archived_at
     from memberships m join groups g on g.id = m.group_id
     where m.user_id = $1 and g.archived_at is null
     order by g.id`,
    [userId],
  )
  return rows.map(toGroup)
}

export async function groupMembers(db: Db, groupId: number): Promise<User[]> {
  const rows = await db.q(
    `select u.id::int8 as id, u.username, u.first_name, u.display_name, u.name_locked
     from memberships m join users u on u.id = m.user_id
     where m.group_id = $1
     order by coalesce(u.display_name, u.first_name, ''), u.id`,
    [groupId],
  )
  return rows.map((r) => ({
    id: Number(r.id),
    username: (r.username as string) ?? null,
    first_name: (r.first_name as string) ?? null,
    display_name: (r.display_name as string) ?? null,
    name_locked: Boolean(r.name_locked),
  }))
}
```

- [ ] **Step 5: Написать `lib/trackers.ts`**

```ts
import type { Db } from './db.ts'

export type TrackerKind = 'check' | 'number'

export type Tracker = {
  id: number
  title: string
  kind: TrackerKind
  target: number
  unit: string | null
  archived_at: string | null
}

const COLS = `id, title, kind, target::float8 as target, unit, archived_at::text as archived_at`

function toTracker(row: Record<string, unknown>): Tracker {
  return {
    id: Number(row.id),
    title: row.title as string,
    kind: row.kind as TrackerKind,
    target: Number(row.target),
    unit: (row.unit as string) ?? null,
    archived_at: (row.archived_at as string) ?? null,
  }
}

export async function createTracker(
  db: Db,
  t: { title: string; kind: TrackerKind; target?: number; unit?: string | null },
): Promise<Tracker> {
  const [row] = await db.q(
    `insert into trackers (title, kind, target, unit) values ($1, $2, $3, $4)
     returning ${COLS}`,
    [t.title, t.kind, t.kind === 'check' ? 1 : (t.target ?? 1), t.kind === 'check' ? null : (t.unit ?? null)],
  )
  return toTracker(row)
}

export async function updateTracker(
  db: Db,
  id: number,
  t: { title: string; target: number; unit: string | null },
): Promise<void> {
  await db.q(`update trackers set title = $2, target = $3, unit = $4 where id = $1`,
    [id, t.title, t.target, t.unit])
}

export async function archiveTracker(db: Db, id: number): Promise<void> {
  await db.q(`update trackers set archived_at = now() where id = $1`, [id])
}

export async function listTrackers(
  db: Db,
  opts: { includeArchived?: boolean } = {},
): Promise<(Tracker & { group_ids: number[] })[]> {
  const where = opts.includeArchived ? '' : 'where t.archived_at is null'
  const rows = await db.q(
    `select t.id, t.title, t.kind, t.target::float8 as target, t.unit,
            t.archived_at::text as archived_at,
            coalesce(array_agg(gt.group_id order by gt.group_id)
                     filter (where gt.group_id is not null), '{}') as group_ids
     from trackers t left join group_trackers gt on gt.tracker_id = t.id
     ${where}
     group by t.id
     order by t.id`,
  )
  return rows.map((r) => ({ ...toTracker(r), group_ids: (r.group_ids as number[]).map(Number) }))
}

export async function setGroupTracker(
  db: Db, groupId: number, trackerId: number, on: boolean,
): Promise<void> {
  if (on) {
    await db.q(
      `insert into group_trackers (group_id, tracker_id) values ($1, $2) on conflict do nothing`,
      [groupId, trackerId],
    )
  } else {
    await db.q(`delete from group_trackers where group_id = $1 and tracker_id = $2`,
      [groupId, trackerId])
  }
}

export async function groupTrackers(db: Db, groupId: number): Promise<Tracker[]> {
  const rows = await db.q(
    `select t.id, t.title, t.kind, t.target::float8 as target, t.unit,
            t.archived_at::text as archived_at
     from group_trackers gt join trackers t on t.id = gt.tracker_id
     where gt.group_id = $1 and t.archived_at is null
     order by t.id`,
    [groupId],
  )
  return rows.map(toTracker)
}

export async function activeTrackersForUser(db: Db, userId: number): Promise<Tracker[]> {
  const rows = await db.q(
    `select distinct on (t.id)
            t.id, t.title, t.kind, t.target::float8 as target, t.unit,
            t.archived_at::text as archived_at
     from memberships m
     join groups g on g.id = m.group_id and g.archived_at is null
     join group_trackers gt on gt.group_id = g.id
     join trackers t on t.id = gt.tracker_id and t.archived_at is null
     where m.user_id = $1
     order by t.id`,
    [userId],
  )
  return rows.map(toTracker)
}
```

- [ ] **Step 6: Запустить тесты и убедиться, что они проходят**

Run: `npm test -- tests/groups.test.ts tests/trackers.test.ts`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add lib/groups.ts lib/trackers.ts tests/groups.test.ts tests/trackers.test.ts
git commit -m "feat: groups, tracker catalog and their links"
```

---

### Task 4: Отметки, ввод чисел и дедуп апдейтов

**Files:**
- Create: `lib/entries.ts`
- Test: `tests/entries.test.ts`

**Interfaces:**
- Consumes: `Db`, `Tracker`.
- Produces:
  - `type DayState = { tracker_id: number; value: number; done: boolean }`
  - `toggleCheck(db, userId, trackerId, day): Promise<{ done: boolean }>`
  - `setValue(db, userId, trackerId, day, value: number): Promise<{ done: boolean; cleared: boolean }>`
  - `dayState(db, userId, day): Promise<Map<number, DayState>>`
  - `claimUpdate(db, updateId: number): Promise<boolean>` — `true`, если апдейт видим впервые
  - `setPending(db, userId, trackerId)`, `takePending(db, userId, maxAgeMinutes?): Promise<number | null>`, `clearPending(db, userId)`
  - `parseNumber(raw: string): number | null`

- [ ] **Step 1: Написать падающий тест `tests/entries.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { createGroup, setMembership } from '../lib/groups.ts'
import { createTracker, setGroupTracker } from '../lib/trackers.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import {
  claimUpdate, clearPending, dayState, parseNumber, setPending, setValue, takePending, toggleCheck,
} from '../lib/entries.ts'
import { testDb } from './helpers.ts'

const DAY = '2026-09-10'

async function fixture() {
  const db = await testDb()
  await upsertFromTelegram(db, { id: 7, first_name: 'А' })
  const g = await createGroup(db, 'Утро')
  const check = await createTracker(db, { title: 'Зарядка', kind: 'check' })
  const pages = await createTracker(db, { title: 'Страницы', kind: 'number', target: 10, unit: 'стр.' })
  await setGroupTracker(db, g.id, check.id, true)
  await setGroupTracker(db, g.id, pages.id, true)
  await setMembership(db, 7, g.id, true)
  return { db, g, check, pages }
}

describe('toggleCheck', () => {
  it('два тапа возвращают исходное состояние', async () => {
    const { db, check } = await fixture()
    expect(await toggleCheck(db, 7, check.id, DAY)).toEqual({ done: true })
    expect(await toggleCheck(db, 7, check.id, DAY)).toEqual({ done: false })
    expect((await dayState(db, 7, DAY)).size).toBe(0)
  })
})

describe('setValue', () => {
  it('значение ниже цели записывается, но выполнением не считается', async () => {
    const { db, pages } = await fixture()
    expect(await setValue(db, 7, pages.id, DAY, 4)).toEqual({ done: false, cleared: false })
    expect((await dayState(db, 7, DAY)).get(pages.id)).toEqual({
      tracker_id: pages.id, value: 4, done: false,
    })
  })

  it('значение с цели и выше — выполнение; повторная запись перезаписывает', async () => {
    const { db, pages } = await fixture()
    await setValue(db, 7, pages.id, DAY, 4)
    expect(await setValue(db, 7, pages.id, DAY, 12.5)).toEqual({ done: true, cleared: false })
    expect((await dayState(db, 7, DAY)).get(pages.id)?.value).toBe(12.5)
  })

  it('ноль стирает отметку', async () => {
    const { db, pages } = await fixture()
    await setValue(db, 7, pages.id, DAY, 12)
    expect(await setValue(db, 7, pages.id, DAY, 0)).toEqual({ done: false, cleared: true })
    expect((await dayState(db, 7, DAY)).has(pages.id)).toBe(false)
  })
})

describe('parseNumber', () => {
  it('принимает целые, дробные и запятую, отвергает мусор', () => {
    expect(parseNumber('12')).toBe(12)
    expect(parseNumber(' 12.5 ')).toBe(12.5)
    expect(parseNumber('12,5')).toBe(12.5)
    expect(parseNumber('0')).toBe(0)
    expect(parseNumber('-3')).toBeNull()
    expect(parseNumber('двенадцать')).toBeNull()
    expect(parseNumber('')).toBeNull()
  })
})

describe('claimUpdate', () => {
  it('первый раз true, повтор false', async () => {
    const { db } = await fixture()
    expect(await claimUpdate(db, 555)).toBe(true)
    expect(await claimUpdate(db, 555)).toBe(false)
  })
})

describe('pending_input', () => {
  it('хранит один трекер на человека и протухает', async () => {
    const { db, pages, check } = await fixture()
    await setPending(db, 7, pages.id)
    await setPending(db, 7, check.id)
    expect(await takePending(db, 7)).toBe(check.id)

    await setPending(db, 7, pages.id)
    await db.q(`update pending_input set at = now() - interval '16 minutes' where user_id = 7`)
    expect(await takePending(db, 7, 15)).toBeNull()

    await setPending(db, 7, pages.id)
    await clearPending(db, 7)
    expect(await takePending(db, 7)).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm test -- tests/entries.test.ts`
Expected: FAIL — нет `lib/entries.ts`.

- [ ] **Step 3: Написать `lib/entries.ts`**

```ts
import type { Db } from './db.ts'

export type DayState = { tracker_id: number; value: number; done: boolean }

export async function toggleCheck(
  db: Db, userId: number, trackerId: number, day: string,
): Promise<{ done: boolean }> {
  const removed = await db.q(
    `delete from entries where user_id = $1 and tracker_id = $2 and day = $3::date
     returning value`,
    [userId, trackerId, day],
  )
  if (removed.length > 0) return { done: false }

  await db.q(
    `insert into entries (user_id, tracker_id, day, value) values ($1, $2, $3::date, 1)
     on conflict (user_id, tracker_id, day) do update set value = 1`,
    [userId, trackerId, day],
  )
  return { done: true }
}

export async function setValue(
  db: Db, userId: number, trackerId: number, day: string, value: number,
): Promise<{ done: boolean; cleared: boolean }> {
  if (value <= 0) {
    await db.q(`delete from entries where user_id = $1 and tracker_id = $2 and day = $3::date`,
      [userId, trackerId, day])
    return { done: false, cleared: true }
  }

  const [row] = await db.q(
    `insert into entries (user_id, tracker_id, day, value) values ($1, $2, $3::date, $4)
     on conflict (user_id, tracker_id, day) do update set value = excluded.value
     returning (value >= (select target from trackers where id = $2)) as done`,
    [userId, trackerId, day, value],
  )
  return { done: Boolean(row.done), cleared: false }
}

export async function dayState(
  db: Db, userId: number, day: string,
): Promise<Map<number, DayState>> {
  const rows = await db.q(
    `select e.tracker_id, e.value::float8 as value, (e.value >= t.target) as done
     from entries e join trackers t on t.id = e.tracker_id
     where e.user_id = $1 and e.day = $2::date`,
    [userId, day],
  )
  return new Map(rows.map((r) => [
    Number(r.tracker_id),
    { tracker_id: Number(r.tracker_id), value: Number(r.value), done: Boolean(r.done) },
  ]))
}

export function parseNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

export async function claimUpdate(db: Db, updateId: number): Promise<boolean> {
  const rows = await db.q(
    `insert into processed (update_id) values ($1) on conflict do nothing returning update_id`,
    [updateId],
  )
  await db.q(`delete from processed where at < now() - interval '1 day'`)
  return rows.length > 0
}

export async function setPending(db: Db, userId: number, trackerId: number): Promise<void> {
  await db.q(
    `insert into pending_input (user_id, tracker_id, at) values ($1, $2, now())
     on conflict (user_id) do update set tracker_id = excluded.tracker_id, at = now()`,
    [userId, trackerId],
  )
}

export async function takePending(
  db: Db, userId: number, maxAgeMinutes = 15,
): Promise<number | null> {
  const [row] = await db.q(
    `select tracker_id from pending_input
     where user_id = $1 and at > now() - ($2 || ' minutes')::interval`,
    [userId, String(maxAgeMinutes)],
  )
  return row ? Number(row.tracker_id) : null
}

export async function clearPending(db: Db, userId: number): Promise<void> {
  await db.q(`delete from pending_input where user_id = $1`, [userId])
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npm test -- tests/entries.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add lib/entries.ts tests/entries.test.ts
git commit -m "feat: entries toggle, numeric input and update dedup"
```

---

### Task 5: Личная статистика

**Files:**
- Create: `lib/stats.ts`
- Test: `tests/stats.test.ts`

**Interfaces:**
- Consumes: `Db`, `Tracker`.
- Produces:
  - `type TrackerStats = { tracker: Tracker; start_day: string; done_week: number; expected_week: number; done_month: number; expected_month: number; streak: number; misses: number; sum_week: number }`
  - `userStats(db, userId: number, today: string): Promise<TrackerStats[]>`
  - `weekStart(day: string): string` — понедельник недели, чистая функция над `YYYY-MM-DD`
  - `monthStart(day: string): string`

Ключевое правило (спека §4): начало отсчёта пары (человек, трекер) —
`min по группам от max(joined_at, linked_at, tracker.created_at)`.

- [ ] **Step 1: Написать падающий тест `tests/stats.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { createGroup, setMembership } from '../lib/groups.ts'
import { createTracker, setGroupTracker } from '../lib/trackers.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { setValue, toggleCheck } from '../lib/entries.ts'
import { monthStart, userStats, weekStart } from '../lib/stats.ts'
import { testDb } from './helpers.ts'

// «Сегодня» в тестах — четверг.
const TODAY = '2026-09-10'

describe('weekStart / monthStart', () => {
  it('неделя начинается с понедельника', () => {
    expect(weekStart('2026-09-10')).toBe('2026-09-07') // чт → пн
    expect(weekStart('2026-09-07')).toBe('2026-09-07')
    expect(weekStart('2026-09-13')).toBe('2026-09-07') // вс → пн той же недели
    expect(monthStart('2026-09-10')).toBe('2026-09-01')
  })
})

async function fixture(opts: { joinedAt?: string; trackerCreatedAt?: string } = {}) {
  const db = await testDb()
  await upsertFromTelegram(db, { id: 7, first_name: 'А' })
  const g = await createGroup(db, 'Утро')
  const check = await createTracker(db, { title: 'Зарядка', kind: 'check' })
  await setGroupTracker(db, g.id, check.id, true)
  await setMembership(db, 7, g.id, true)

  if (opts.trackerCreatedAt) {
    await db.q(`update trackers set created_at = $1::timestamptz where id = $2`,
      [opts.trackerCreatedAt, check.id])
  }
  if (opts.joinedAt) {
    await db.q(`update memberships set joined_at = $1::timestamptz where user_id = 7`,
      [opts.joinedAt])
    await db.q(`update group_trackers set linked_at = $1::timestamptz`, [opts.joinedAt])
  }
  return { db, g, check }
}

describe('userStats', () => {
  it('считает неделю от даты вступления, а не от начала недели', async () => {
    // Человек в группе со среды: ожидаются ср, чт — два дня, а не семь.
    const { db, check } = await fixture({
      joinedAt: '2026-09-09T08:00:00Z', trackerCreatedAt: '2026-01-01T00:00:00Z',
    })
    await toggleCheck(db, 7, check.id, '2026-09-09')

    const [s] = await userStats(db, 7, TODAY)
    expect(s.start_day).toBe('2026-09-09')
    expect(s.expected_week).toBe(2)
    expect(s.done_week).toBe(1)
  })

  it('серия тянется до вчера и не рвётся отсутствием отметки сегодня', async () => {
    const { db, check } = await fixture({
      joinedAt: '2026-09-01T00:00:00Z', trackerCreatedAt: '2026-01-01T00:00:00Z',
    })
    for (const d of ['2026-09-07', '2026-09-08', '2026-09-09']) {
      await toggleCheck(db, 7, check.id, d)
    }

    const [s] = await userStats(db, 7, TODAY)
    expect(s.streak).toBe(3)
  })

  it('серия обнуляется, если последняя отметка позавчера', async () => {
    const { db, check } = await fixture({
      joinedAt: '2026-09-01T00:00:00Z', trackerCreatedAt: '2026-01-01T00:00:00Z',
    })
    await toggleCheck(db, 7, check.id, '2026-09-08')

    const [s] = await userStats(db, 7, TODAY)
    expect(s.streak).toBe(0)
  })

  it('пропуски считаются по вчера включительно', async () => {
    // В группе с 8-го, отмечено только 8-е: пропуск — 9-е. Сегодня (10-е) не в счёт.
    const { db, check } = await fixture({
      joinedAt: '2026-09-08T00:00:00Z', trackerCreatedAt: '2026-01-01T00:00:00Z',
    })
    await toggleCheck(db, 7, check.id, '2026-09-08')

    const [s] = await userStats(db, 7, TODAY)
    expect(s.misses).toBe(1)
  })

  it('числовой трекер: сумма за неделю и выполнение по цели', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7 })
    const g = await createGroup(db, 'Утро')
    const pages = await createTracker(db, { title: 'Страницы', kind: 'number', target: 10, unit: 'стр.' })
    await setGroupTracker(db, g.id, pages.id, true)
    await setMembership(db, 7, g.id, true)
    await db.q(`update memberships set joined_at = '2026-09-07T00:00:00Z'`)
    await db.q(`update group_trackers set linked_at = '2026-09-07T00:00:00Z'`)
    await db.q(`update trackers set created_at = '2026-01-01T00:00:00Z'`)

    await setValue(db, 7, pages.id, '2026-09-07', 12)
    await setValue(db, 7, pages.id, '2026-09-08', 4)

    const [s] = await userStats(db, 7, TODAY)
    expect(s.done_week).toBe(1)      // только 12 ≥ 10
    expect(s.sum_week).toBe(16)
    expect(s.expected_week).toBe(4)  // пн–чт
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm test -- tests/stats.test.ts`
Expected: FAIL — нет `lib/stats.ts`.

- [ ] **Step 3: Написать `lib/stats.ts`**

```ts
import type { Db } from './db.ts'
import type { Tracker } from './trackers.ts'

export type TrackerStats = {
  tracker: Tracker
  start_day: string
  done_week: number
  expected_week: number
  done_month: number
  expected_month: number
  streak: number
  misses: number
  sum_week: number
}

export function weekStart(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  const shift = (d.getUTCDay() + 6) % 7 // пн = 0
  d.setUTCDate(d.getUTCDate() - shift)
  return d.toISOString().slice(0, 10)
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`
}

// Один запрос на всё: старт пары, выполнения и суммы за неделю/месяц, серия, пропуски.
const SQL = `
with pair as (
  select t.id as tracker_id, t.title, t.kind, t.target, t.unit,
         min(greatest(m.joined_at, gt.linked_at, t.created_at))::date as start_day
  from memberships m
  join groups g on g.id = m.group_id and g.archived_at is null
  join group_trackers gt on gt.group_id = g.id
  join trackers t on t.id = gt.tracker_id and t.archived_at is null
  where m.user_id = $1
  group by t.id
),
done as (
  select p.tracker_id, e.day, e.value
  from pair p join entries e
    on e.tracker_id = p.tracker_id and e.user_id = $1 and e.value >= p.target
  where e.day <= $2::date
),
streak_grp as (
  select tracker_id, day,
         (day - (row_number() over (partition by tracker_id order by day))::int) as g
  from done
),
streak_last as (
  select distinct on (tracker_id) tracker_id, g, max_day
  from (
    select tracker_id, g, max(day) as max_day, count(*)::int as len from streak_grp
    group by tracker_id, g
  ) x
  order by tracker_id, max_day desc
),
streak as (
  select s.tracker_id,
         case when s.max_day >= $2::date - 1
              then (select count(*)::int from streak_grp sg
                    where sg.tracker_id = s.tracker_id and sg.g = s.g)
              else 0 end as streak
  from streak_last s
)
select p.tracker_id, p.title, p.kind, p.target::float8 as target, p.unit,
       p.start_day::text as start_day,
       greatest(0, ($2::date - greatest(p.start_day, $3::date)) + 1)::int as expected_week,
       greatest(0, ($2::date - greatest(p.start_day, $4::date)) + 1)::int as expected_month,
       (select count(*)::int from done d
        where d.tracker_id = p.tracker_id and d.day >= $3::date) as done_week,
       (select count(*)::int from done d
        where d.tracker_id = p.tracker_id and d.day >= $4::date) as done_month,
       coalesce((select sum(e.value)::float8 from entries e
                 where e.user_id = $1 and e.tracker_id = p.tracker_id
                   and e.day between greatest(p.start_day, $3::date) and $2::date), 0) as sum_week,
       coalesce((select streak from streak s where s.tracker_id = p.tracker_id), 0)::int as streak,
       greatest(0, ($2::date - 1 - greatest(p.start_day, p.start_day)) + 1)::int
         - (select count(*)::int from done d
            where d.tracker_id = p.tracker_id and d.day <= $2::date - 1) as misses
from pair p
order by p.tracker_id
`

export async function userStats(db: Db, userId: number, today: string): Promise<TrackerStats[]> {
  const rows = await db.q(SQL, [userId, today, weekStart(today), monthStart(today)])
  return rows.map((r) => ({
    tracker: {
      id: Number(r.tracker_id),
      title: r.title as string,
      kind: r.kind as Tracker['kind'],
      target: Number(r.target),
      unit: (r.unit as string) ?? null,
      archived_at: null,
    },
    start_day: r.start_day as string,
    done_week: Number(r.done_week),
    expected_week: Number(r.expected_week),
    done_month: Number(r.done_month),
    expected_month: Number(r.expected_month),
    streak: Number(r.streak),
    misses: Math.max(0, Number(r.misses)),
    sum_week: Number(r.sum_week),
  }))
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npm test -- tests/stats.test.ts`
Expected: PASS. Если `misses` или `streak` разойдутся с ожиданием — правьте SQL, а не тест: сценарии взяты из спеки §5.

- [ ] **Step 5: Коммит**

```bash
git add lib/stats.ts tests/stats.test.ts
git commit -m "feat: personal stats — percent, streak, misses, sums"
```

---

### Task 6: Групповая статистика

**Files:**
- Create: `lib/group-stats.ts`
- Test: `tests/group-stats.test.ts`

**Interfaces:**
- Consumes: `Db`, `weekStart`/`monthStart` из `lib/stats.ts`, `personName`.
- Produces:
  - `type MemberScore = { user_id: number; name: string; done: number; expected: number; percent: number }`
  - `type TrackerScore = { tracker_id: number; title: string; percent: number; sum: number; unit: string | null; kind: 'check' | 'number' }`
  - `type DayCell = { user_id: number; day: string; percent: number }`
  - `type GroupReport = { group_id: number; title: string; from: string; to: string; members: MemberScore[]; trackers: TrackerScore[]; days: DayCell[]; percent: number }`
  - `groupReport(db, groupId: number, from: string, to: string): Promise<GroupReport>`
  - `missingToday(db, groupId: number, today: string): Promise<{ user_id: number; name: string; titles: string[] }[]>`
  - `usersWithUnfinished(db, today: string): Promise<{ user_id: number; count: number }[]>` — для вечернего напоминания

- [ ] **Step 1: Написать падающий тест `tests/group-stats.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { createGroup, setMembership } from '../lib/groups.ts'
import { createTracker, setGroupTracker } from '../lib/trackers.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { toggleCheck } from '../lib/entries.ts'
import { groupReport, missingToday, usersWithUnfinished } from '../lib/group-stats.ts'
import { testDb } from './helpers.ts'

const FROM = '2026-09-07'
const TODAY = '2026-09-10'

async function fixture() {
  const db = await testDb()
  await upsertFromTelegram(db, { id: 1, first_name: 'Айгуль' })
  await upsertFromTelegram(db, { id: 2, first_name: 'Данияр' })
  const g = await createGroup(db, 'Утро')
  const charge = await createTracker(db, { title: 'Зарядка', kind: 'check' })
  await setGroupTracker(db, g.id, charge.id, true)
  await setMembership(db, 1, g.id, true)
  await setMembership(db, 2, g.id, true)
  await db.q(`update memberships set joined_at = '2026-09-01T00:00:00Z'`)
  await db.q(`update group_trackers set linked_at = '2026-09-01T00:00:00Z'`)
  await db.q(`update trackers set created_at = '2026-01-01T00:00:00Z'`)
  return { db, g, charge }
}

describe('groupReport', () => {
  it('считает процент участника от ожидаемых дней периода', async () => {
    const { db, g, charge } = await fixture()
    for (const d of ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10']) {
      await toggleCheck(db, 1, charge.id, d)
    }
    await toggleCheck(db, 2, charge.id, '2026-09-07')

    const rep = await groupReport(db, g.id, FROM, TODAY)
    const aigul = rep.members.find((m) => m.user_id === 1)!
    const daniyar = rep.members.find((m) => m.user_id === 2)!

    expect(aigul).toMatchObject({ done: 4, expected: 4, percent: 100 })
    expect(daniyar).toMatchObject({ done: 1, expected: 4, percent: 25 })
    expect(rep.percent).toBe(63) // среднее по участникам, округление к ближайшему
    expect(rep.trackers[0]).toMatchObject({ title: 'Зарядка', percent: 63 })
  })

  it('участник, добавленный позже, не получает нули за прошедшие дни', async () => {
    const { db, g, charge } = await fixture()
    await db.q(`update memberships set joined_at = '2026-09-10T06:00:00Z' where user_id = 2`)
    await toggleCheck(db, 2, charge.id, TODAY)

    const rep = await groupReport(db, g.id, FROM, TODAY)
    expect(rep.members.find((m) => m.user_id === 2)).toMatchObject({
      done: 1, expected: 1, percent: 100,
    })
  })

  it('карта дней отдаёт по ячейке на участника и день периода', async () => {
    const { db, g, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, '2026-09-08')

    const rep = await groupReport(db, g.id, FROM, TODAY)
    expect(rep.days.filter((d) => d.user_id === 1)).toHaveLength(4)
    expect(rep.days.find((d) => d.user_id === 1 && d.day === '2026-09-08')?.percent).toBe(100)
    expect(rep.days.find((d) => d.user_id === 1 && d.day === '2026-09-07')?.percent).toBe(0)
  })
})

describe('missingToday', () => {
  it('перечисляет, кто и какие трекеры не закрыл сегодня', async () => {
    const { db, g, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, TODAY)

    const missing = await missingToday(db, g.id, TODAY)
    expect(missing).toEqual([{ user_id: 2, name: 'Данияр', titles: ['Зарядка'] }])
  })
})

describe('usersWithUnfinished', () => {
  it('возвращает только тех, у кого остались незакрытые трекеры', async () => {
    const { db, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, TODAY)

    expect(await usersWithUnfinished(db, TODAY)).toEqual([{ user_id: 2, count: 1 }])
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm test -- tests/group-stats.test.ts`
Expected: FAIL — нет `lib/group-stats.ts`.

- [ ] **Step 3: Написать `lib/group-stats.ts`**

```ts
import type { Db } from './db.ts'
import { personName } from './text.ts'

export type MemberScore = {
  user_id: number; name: string; done: number; expected: number; percent: number
}
export type TrackerScore = {
  tracker_id: number; title: string; kind: 'check' | 'number'
  percent: number; sum: number; unit: string | null
}
export type DayCell = { user_id: number; day: string; percent: number }
export type GroupReport = {
  group_id: number; title: string; from: string; to: string
  members: MemberScore[]; trackers: TrackerScore[]; days: DayCell[]; percent: number
}

const pct = (done: number, expected: number) =>
  expected > 0 ? Math.round((done / expected) * 100) : 0

// Пары (участник, трекер) со своей датой старта — основа всех трёх выборок ниже.
const PAIRS = `
  select m.user_id, t.id as tracker_id, t.target, t.title, t.kind, t.unit,
         greatest(m.joined_at, gt.linked_at, t.created_at)::date as start_day
  from memberships m
  join group_trackers gt on gt.group_id = m.group_id
  join trackers t on t.id = gt.tracker_id and t.archived_at is null
  where m.group_id = $1
`

export async function groupReport(
  db: Db, groupId: number, from: string, to: string,
): Promise<GroupReport> {
  const [g] = await db.q(`select id, title from groups where id = $1`, [groupId])

  const members = await db.q(
    `with pairs as (${PAIRS})
     select u.id::int8 as user_id, u.display_name, u.first_name, u.username,
            sum(greatest(0, ($3::date - greatest(p.start_day, $2::date)) + 1))::int as expected,
            coalesce(sum((select count(*) from entries e
                          where e.user_id = p.user_id and e.tracker_id = p.tracker_id
                            and e.value >= p.target
                            and e.day between greatest(p.start_day, $2::date) and $3::date)), 0)::int as done
     from pairs p join users u on u.id = p.user_id
     group by u.id
     order by coalesce(u.display_name, u.first_name, ''), u.id`,
    [groupId, from, to],
  )

  const trackers = await db.q(
    `with pairs as (${PAIRS})
     select p.tracker_id, p.title, p.kind, p.unit,
            sum(greatest(0, ($3::date - greatest(p.start_day, $2::date)) + 1))::int as expected,
            coalesce(sum((select count(*) from entries e
                          where e.user_id = p.user_id and e.tracker_id = p.tracker_id
                            and e.value >= p.target
                            and e.day between greatest(p.start_day, $2::date) and $3::date)), 0)::int as done,
            coalesce(sum((select coalesce(sum(e.value), 0) from entries e
                          where e.user_id = p.user_id and e.tracker_id = p.tracker_id
                            and e.day between greatest(p.start_day, $2::date) and $3::date)), 0)::float8 as sum
     from pairs p
     group by p.tracker_id, p.title, p.kind, p.unit
     order by p.tracker_id`,
    [groupId, from, to],
  )

  const days = await db.q(
    `with pairs as (${PAIRS}),
     grid as (
       select p.user_id, d::date as day, p.tracker_id, p.target, p.start_day
       from pairs p, generate_series($2::date, $3::date, interval '1 day') d
       where d::date >= p.start_day
     )
     select user_id::int8 as user_id, day::text as day,
            (100.0 * count(*) filter (
               where exists (select 1 from entries e
                             where e.user_id = grid.user_id and e.tracker_id = grid.tracker_id
                               and e.day = grid.day and e.value >= grid.target)
             ) / count(*))::float8 as percent
     from grid group by user_id, day order by user_id, day`,
    [groupId, from, to],
  )

  const memberScores: MemberScore[] = members.map((r) => ({
    user_id: Number(r.user_id),
    name: personName({
      id: Number(r.user_id),
      display_name: (r.display_name as string) ?? null,
      first_name: (r.first_name as string) ?? null,
      username: (r.username as string) ?? null,
    }),
    done: Number(r.done),
    expected: Number(r.expected),
    percent: pct(Number(r.done), Number(r.expected)),
  }))

  return {
    group_id: Number(g.id),
    title: g.title as string,
    from,
    to,
    members: memberScores,
    trackers: trackers.map((r) => ({
      tracker_id: Number(r.tracker_id),
      title: r.title as string,
      kind: r.kind as 'check' | 'number',
      unit: (r.unit as string) ?? null,
      percent: pct(Number(r.done), Number(r.expected)),
      sum: Number(r.sum),
    })),
    days: days.map((r) => ({
      user_id: Number(r.user_id),
      day: r.day as string,
      percent: Math.round(Number(r.percent)),
    })),
    percent: memberScores.length
      ? Math.round(memberScores.reduce((a, m) => a + m.percent, 0) / memberScores.length)
      : 0,
  }
}

export async function missingToday(
  db: Db, groupId: number, today: string,
): Promise<{ user_id: number; name: string; titles: string[] }[]> {
  const rows = await db.q(
    `with pairs as (${PAIRS})
     select u.id::int8 as user_id, u.display_name, u.first_name, u.username,
            array_agg(p.title order by p.tracker_id) as titles
     from pairs p join users u on u.id = p.user_id
     where p.start_day <= $2::date
       and not exists (select 1 from entries e
                       where e.user_id = p.user_id and e.tracker_id = p.tracker_id
                         and e.day = $2::date and e.value >= p.target)
     group by u.id
     order by coalesce(u.display_name, u.first_name, ''), u.id`,
    [groupId, today],
  )
  return rows.map((r) => ({
    user_id: Number(r.user_id),
    name: personName({
      id: Number(r.user_id),
      display_name: (r.display_name as string) ?? null,
      first_name: (r.first_name as string) ?? null,
      username: (r.username as string) ?? null,
    }),
    titles: r.titles as string[],
  }))
}

export async function usersWithUnfinished(
  db: Db, today: string,
): Promise<{ user_id: number; count: number }[]> {
  const rows = await db.q(
    `select m.user_id::int8 as user_id, count(distinct t.id)::int as count
     from memberships m
     join groups g on g.id = m.group_id and g.archived_at is null
     join group_trackers gt on gt.group_id = g.id
     join trackers t on t.id = gt.tracker_id and t.archived_at is null
     where greatest(m.joined_at, gt.linked_at, t.created_at)::date <= $1::date
       and not exists (select 1 from entries e
                       where e.user_id = m.user_id and e.tracker_id = t.id
                         and e.day = $1::date and e.value >= t.target)
     group by m.user_id
     order by m.user_id`,
    [today],
  )
  return rows.map((r) => ({ user_id: Number(r.user_id), count: Number(r.count) }))
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npm test -- tests/group-stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Прогнать весь набор тестов**

Run: `npm test`
Expected: PASS — задачи 1–6 не должны сломать друг друга.

- [ ] **Step 6: Коммит**

```bash
git add lib/group-stats.ts tests/group-stats.test.ts
git commit -m "feat: group stats — member scores, tracker scores, day map"
```

---

### Task 7: Форматирование и клавиатуры

**Files:**
- Modify: `lib/text.ts`
- Create: `lib/menu.ts`
- Test: `tests/text.test.ts`, `tests/menu.test.ts`

**Interfaces:**
- Consumes: `TrackerStats`, `GroupReport`, `Tracker`, `DayState`.
- Produces (`lib/text.ts`):
  - `bar(percent: number, width?: number): string` — `▰▰▰▱▱`
  - `formatDay(day: string): string` — `четверг, 10 сентября`
  - `formatRange(from: string, to: string): string` — `7–13 сентября`
  - `num(value: number): string` — без хвостовых нулей (`12`, `12.5`)
  - `clip(text: string, limit?: number): string` — обрезка до лимита Telegram с хвостом `…и ещё N строк`
  - `padRight(text: string, width: number): string`
- Produces (`lib/menu.ts`):
  - `mainScreen(args: { day: string; trackers: Tracker[]; state: Map<number, DayState> }): { text: string; keyboard: InlineKeyboardMarkup }`
  - `statsScreen(stats: TrackerStats[]): string`
  - `groupScreen(report: GroupReport, viewerId: number, missing: {...}[]): string`
  - `groupsKeyboard(groups: Group[], prefix: string): InlineKeyboardMarkup`

- [ ] **Step 1: Написать падающий тест `tests/text.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { bar, clip, formatDay, formatRange, num, padRight } from '../lib/text.ts'

describe('bar', () => {
  it('рисует заполнение по проценту', () => {
    expect(bar(0, 5)).toBe('▱▱▱▱▱')
    expect(bar(100, 5)).toBe('▰▰▰▰▰')
    expect(bar(43, 7)).toBe('▰▰▰▱▱▱▱')
  })
})

describe('formatDay / formatRange', () => {
  it('пишет дату по-русски', () => {
    expect(formatDay('2026-09-10')).toBe('четверг, 10 сентября')
    expect(formatRange('2026-09-07', '2026-09-13')).toBe('7–13 сентября')
    expect(formatRange('2026-08-31', '2026-09-06')).toBe('31 августа – 6 сентября')
  })
})

describe('num', () => {
  it('убирает хвостовые нули', () => {
    expect(num(12)).toBe('12')
    expect(num(12.5)).toBe('12,5')
    expect(num(12.0)).toBe('12')
  })
})

describe('clip', () => {
  it('режет длинный текст по строкам и дописывает хвост', () => {
    const text = Array.from({ length: 500 }, (_, i) => `строка номер ${i}`).join('\n')
    const out = clip(text, 200)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out).toMatch(/…и ещё \d+ строк/)
  })

  it('короткий текст не трогает', () => {
    expect(clip('привет', 100)).toBe('привет')
  })
})

describe('padRight', () => {
  it('дополняет до ширины и не обрезает длиннее', () => {
    expect(padRight('Айгуль', 10)).toBe('Айгуль    ')
    expect(padRight('Айгуль', 3)).toBe('Айгуль')
  })
})
```

- [ ] **Step 2: Написать падающий тест `tests/menu.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { mainScreen, statsScreen } from '../lib/menu.ts'
import type { Tracker } from '../lib/trackers.ts'

const check: Tracker = { id: 1, title: 'Зарядка', kind: 'check', target: 1, unit: null, archived_at: null }
const pages: Tracker = { id: 2, title: 'Страницы', kind: 'number', target: 10, unit: 'стр.', archived_at: null }

describe('mainScreen', () => {
  it('рисует галочки, числа и счётчик выполненного', () => {
    const state = new Map([
      [1, { tracker_id: 1, value: 1, done: true }],
      [2, { tracker_id: 2, value: 4, done: false }],
    ])
    const { text, keyboard } = mainScreen({ day: '2026-09-10', trackers: [check, pages], state })

    expect(text).toContain('четверг, 10 сентября')
    expect(text).toContain('Выполнено 1 из 2')
    const labels = keyboard.inline_keyboard.flat().map((b) => b.text)
    expect(labels).toContain('✅ Зарядка')
    expect(labels).toContain('⬜️ Страницы 4/10')
    expect(keyboard.inline_keyboard.flat().map((b) => (b as { callback_data: string }).callback_data))
      .toContain('t:2')
  })

  it('без трекеров показывает объяснение, а не пустой экран', () => {
    const { text, keyboard } = mainScreen({ day: '2026-09-10', trackers: [], state: new Map() })
    expect(text).toContain('Доступ пока не выдан')
    expect(keyboard.inline_keyboard).toEqual([])
  })
})

describe('statsScreen', () => {
  it('для числового трекера добавляет строку с суммой', () => {
    const text = statsScreen([
      {
        tracker: pages, start_day: '2026-09-07',
        done_week: 3, expected_week: 7, done_month: 12, expected_month: 30,
        streak: 0, misses: 4, sum_week: 47,
      },
    ])
    expect(text).toContain('Страницы')
    expect(text).toContain('3/7')
    expect(text).toContain('47 стр.')
  })
})
```

- [ ] **Step 3: Запустить оба теста и убедиться, что они падают**

Run: `npm test -- tests/text.test.ts tests/menu.test.ts`
Expected: FAIL.

- [ ] **Step 4: Дописать `lib/text.ts`**

```ts
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
```

- [ ] **Step 5: Написать `lib/menu.ts`**

```ts
import type { InlineKeyboardMarkup } from 'grammy/types'
import type { DayState } from './entries.ts'
import type { Group } from './groups.ts'
import type { GroupReport } from './group-stats.ts'
import type { TrackerStats } from './stats.ts'
import type { Tracker } from './trackers.ts'
import { bar, formatDay, formatRange, num, padRight } from './text.ts'

export function mainScreen(args: {
  day: string
  trackers: Tracker[]
  state: Map<number, DayState>
}): { text: string; keyboard: InlineKeyboardMarkup } {
  const { day, trackers, state } = args

  if (trackers.length === 0) {
    return {
      text: 'Доступ пока не выдан: администратор уже получил уведомление.',
      keyboard: { inline_keyboard: [] },
    }
  }

  const done = trackers.filter((t) => state.get(t.id)?.done).length
  const text = [
    `Сегодня, ${formatDay(day)}`,
    `Выполнено ${done} из ${trackers.length}  ${bar(Math.round((done / trackers.length) * 100), 5)}`,
  ].join('\n')

  const rows = trackers.map((t) => {
    const st = state.get(t.id)
    const mark = st?.done ? '✅' : '⬜️'
    const label = t.kind === 'number'
      ? `${mark} ${t.title} ${num(st?.value ?? 0)}/${num(t.target)}`
      : `${mark} ${t.title}`
    return [{ text: label, callback_data: `t:${t.id}` }]
  })

  rows.push([
    { text: '📈 Моя статистика', callback_data: 's:me' },
    { text: '👥 Группа', callback_data: 's:g' },
  ])

  return { text, keyboard: { inline_keyboard: rows } }
}

export function statsScreen(stats: TrackerStats[]): string {
  if (stats.length === 0) return 'Пока нет трекеров.'

  const width = Math.max(...stats.map((s) => s.tracker.title.length)) + 1
  const lines: string[] = []
  for (const s of stats) {
    const week = bar(s.expected_week ? (s.done_week / s.expected_week) * 100 : 0)
    const month = s.expected_month ? Math.round((s.done_month / s.expected_month) * 100) : 0
    lines.push(
      `${padRight(s.tracker.title, width)} неделя ${week} ${s.done_week}/${s.expected_week}` +
      `   серия ${s.streak}   месяц ${month}%`,
    )
    if (s.tracker.kind === 'number') {
      const goal = num(s.tracker.target * s.expected_week)
      lines.push(`${' '.repeat(width)} за неделю ${num(s.sum_week)} ${s.tracker.unit ?? ''} (цель ${goal})`)
    }
  }
  return `<pre>${lines.join('\n')}</pre>`
}

export function groupScreen(
  report: GroupReport,
  viewerId: number,
  missing: { name: string; titles: string[] }[],
): string {
  const width = Math.max(...report.members.map((m) => m.name.length), 6) + 1
  const rows = report.members.map((m) =>
    `${padRight(m.user_id === viewerId ? 'Вы' : m.name, width)}${bar(m.percent)} ${String(m.percent).padStart(3)}%`,
  )
  const head = `Группа «${report.title}», неделя ${formatRange(report.from, report.to)}`
  const tail = missing.length
    ? `\nСегодня не отметились: ${missing.map((m) => `${m.name} — ${m.titles.join(', ')}`).join('; ')}`
    : '\nСегодня отметились все.'
  return `${head}\n<pre>${rows.join('\n')}</pre>${tail}`
}

export function groupsKeyboard(groups: Group[], prefix: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: groups.map((g) => [{ text: g.title, callback_data: `${prefix}${g.id}` }]),
  }
}
```

- [ ] **Step 6: Запустить тесты и убедиться, что они проходят**

Run: `npm test -- tests/text.test.ts tests/menu.test.ts`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add lib/text.ts lib/menu.ts tests/text.test.ts tests/menu.test.ts
git commit -m "feat: formatting helpers and bot screens"
```

---

### Task 8: Бот — онбординг, отметки, статистика

**Files:**
- Create: `lib/bot.ts`, `lib/handlers/user.ts`
- Test: `tests/bot.test.ts`

**Interfaces:**
- Consumes: всё из задач 2–7.
- Produces:
  - `type BotDeps = { db: Db; adminIds: number[]; appUrl: string }`
  - `createBot(token: string, deps: BotDeps, botInfo?: UserFromGetMe): Bot`
  - `registerUser(bot: Bot, deps: BotDeps): void` (в `lib/handlers/user.ts`)
  - `showMain(ctx, deps, opts?: { edit?: boolean }): Promise<void>` — экспортируется, потому что им пользуется напоминание из задачи 14

Тесты гоняют настоящего бота grammY без сети: трансформер перехватывает вызовы API,
`botInfo` передаётся вручную, поэтому `getMe` не вызывается.

- [ ] **Step 1: Написать падающий тест `tests/bot.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import type { Update } from 'grammy/types'
import { createBot } from '../lib/bot.ts'
import { createGroup, setMembership } from '../lib/groups.ts'
import { createTracker, setGroupTracker } from '../lib/trackers.ts'
import { getUser } from '../lib/users.ts'
import { testDb } from './helpers.ts'

const BOT_INFO = {
  id: 42, is_bot: true as const, first_name: 'Tracker', username: 'tracker_bot',
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false,
}

async function harness() {
  const db = await testDb()
  const calls: { method: string; payload: Record<string, unknown> }[] = []
  const bot = createBot('42:TEST', { db, adminIds: [99], appUrl: 'https://example.com' }, BOT_INFO)
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> })
    return { ok: true, result: { message_id: 1 } } as never
  })
  await bot.init()
  return { db, bot, calls }
}

function message(text: string, from = 7): Update {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: 1, date: 0, text,
      chat: { id: from, type: 'private' as const, first_name: 'Ч' },
      from: { id: from, is_bot: false, first_name: 'Человек-паук', username: 'spider' },
    },
  } as Update
}

function tap(data: string, from = 7): Update {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: {
      id: 'cb1', chat_instance: 'x', data,
      from: { id: from, is_bot: false, first_name: 'Ч' },
      message: {
        message_id: 1, date: 0, text: 'меню',
        chat: { id: from, type: 'private' as const, first_name: 'Ч' },
      },
    },
  } as Update
}

describe('онбординг', () => {
  it('новый человек сначала называет имя, и только потом админ получает уведомление', async () => {
    const { db, bot, calls } = await harness()

    await bot.handleUpdate(message('/start'))
    expect(calls.at(-1)?.payload.text).toContain('Как вас зовут')
    expect(calls.some((c) => c.payload.chat_id === 99)).toBe(false)

    await bot.handleUpdate(message('Айгуль Смагулова'))
    expect((await getUser(db, 7))?.display_name).toBe('Айгуль Смагулова')

    const notice = calls.find((c) => c.payload.chat_id === 99)
    expect(notice?.payload.text).toContain('Айгуль Смагулова')
    expect(JSON.stringify(notice?.payload.reply_markup)).toContain('web_app')
  })

  it('невалидное имя не принимается', async () => {
    const { db, bot, calls } = await harness()
    await bot.handleUpdate(message('/start'))
    await bot.handleUpdate(message('!!'))
    expect((await getUser(db, 7))?.display_name).toBeNull()
    expect(calls.at(-1)?.payload.text).toContain('буквами')
  })
})

describe('отметки', () => {
  async function ready() {
    const h = await harness()
    await h.bot.handleUpdate(message('/start'))
    await h.bot.handleUpdate(message('Айгуль Смагулова'))
    const g = await createGroup(h.db, 'Утро')
    const check = await createTracker(h.db, { title: 'Зарядка', kind: 'check' })
    const pages = await createTracker(h.db, {
      title: 'Страницы', kind: 'number', target: 10, unit: 'стр.',
    })
    await setGroupTracker(h.db, g.id, check.id, true)
    await setGroupTracker(h.db, g.id, pages.id, true)
    await setMembership(h.db, 7, g.id, true)
    h.calls.length = 0
    return { ...h, check, pages }
  }

  it('тап по галочке отмечает и перерисовывает меню', async () => {
    const { bot, calls, check } = await ready()
    await bot.handleUpdate(tap(`t:${check.id}`))

    const answer = calls.find((c) => c.method === 'answerCallbackQuery')
    expect(answer?.payload.text).toBe('Отмечено ✅')
    const edit = calls.find((c) => c.method === 'editMessageText')
    expect(JSON.stringify(edit?.payload.reply_markup)).toContain('✅ Зарядка')
  })

  it('тап по числовому просит число, следующее сообщение записывается', async () => {
    const { db, bot, calls, pages } = await ready()
    await bot.handleUpdate(tap(`t:${pages.id}`))
    expect(calls.at(-1)?.payload.text).toContain('число')

    await bot.handleUpdate(message('12'))
    const [row] = await db.q(`select value::float8 as value from entries where tracker_id = $1`, [pages.id])
    expect(row.value).toBe(12)
    expect(calls.some((c) => String(c.payload.text ?? '').includes('Записано'))).toBe(true)
  })

  it('мусор вместо числа не сбрасывает ожидание', async () => {
    const { db, bot, calls, pages } = await ready()
    await bot.handleUpdate(tap(`t:${pages.id}`))
    await bot.handleUpdate(message('много'))
    expect(calls.at(-1)?.payload.text).toContain('Нужно число')

    await bot.handleUpdate(message('7'))
    const [row] = await db.q(`select value::float8 as value from entries where tracker_id = $1`, [pages.id])
    expect(row.value).toBe(7)
  })

  it('статистика открывается кнопкой', async () => {
    const { bot, calls } = await ready()
    await bot.handleUpdate(tap('s:me'))
    expect(String(calls.find((c) => c.method === 'editMessageText')?.payload.text)).toContain('<pre>')
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm test -- tests/bot.test.ts`
Expected: FAIL — нет `lib/bot.ts`.

- [ ] **Step 3: Написать `lib/handlers/user.ts`**

```ts
import type { Bot, Context } from 'grammy'
import type { Db } from '../db.ts'
import { today } from '../db.ts'
import {
  clearPending, dayState, parseNumber, setPending, setValue, takePending, toggleCheck,
} from '../entries.ts'
import { userGroups } from '../groups.ts'
import { groupReport, missingToday } from '../group-stats.ts'
import { groupScreen, groupsKeyboard, mainScreen, statsScreen } from '../menu.ts'
import { userStats, weekStart } from '../stats.ts'
import { activeTrackersForUser } from '../trackers.ts'
import { num } from '../text.ts'
import { setDisplayName, upsertFromTelegram } from '../users.ts'

export type BotDeps = { db: Db; adminIds: number[]; appUrl: string }

export async function showMain(
  ctx: Context, deps: BotDeps, opts: { edit?: boolean } = {},
): Promise<void> {
  const userId = ctx.from!.id
  const day = await today(deps.db)
  const trackers = await activeTrackersForUser(deps.db, userId)
  const state = await dayState(deps.db, userId, day)
  const { text, keyboard } = mainScreen({ day, trackers, state })

  if (opts.edit && ctx.callbackQuery?.message) {
    await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' })
  } else {
    await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' })
  }
}

async function notifyAdmins(ctx: Context, deps: BotDeps, name: string): Promise<void> {
  const u = ctx.from!
  const text = `Новый участник: ${name} (@${u.username ?? '—'}, ${u.id})\nНазначьте ему группы.`
  for (const adminId of deps.adminIds) {
    await ctx.api.sendMessage(adminId, text, {
      reply_markup: {
        inline_keyboard: [[{ text: '⚙️ Открыть админку', web_app: { url: `${deps.appUrl}/admin` } }]],
      },
    })
  }
}

export function registerUser(bot: Bot, deps: BotDeps): void {
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data
    const userId = ctx.from.id
    const day = await today(deps.db)

    if (data.startsWith('t:')) {
      const trackerId = Number(data.slice(2))
      const trackers = await activeTrackersForUser(deps.db, userId)
      const tracker = trackers.find((t) => t.id === trackerId)
      if (!tracker) {
        await ctx.answerCallbackQuery({ text: 'Трекер больше не активен' })
        await showMain(ctx, deps, { edit: true })
        return
      }

      if (tracker.kind === 'number') {
        await setPending(deps.db, userId, tracker.id)
        await ctx.answerCallbackQuery()
        await ctx.reply(
          `Сколько — ${tracker.title.toLowerCase()}? Пришлите число (например 12).`,
          { reply_markup: { force_reply: true } },
        )
        return
      }

      const { done } = await toggleCheck(deps.db, userId, tracker.id, day)
      await ctx.answerCallbackQuery({ text: done ? 'Отмечено ✅' : 'Снято' })
      await showMain(ctx, deps, { edit: true })
      return
    }

    if (data === 's:me') {
      await ctx.answerCallbackQuery()
      const stats = await userStats(deps.db, userId, day)
      await ctx.editMessageText(statsScreen(stats), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '← Назад', callback_data: 'back' }]] },
      })
      return
    }

    if (data === 's:g' || data.startsWith('s:g:')) {
      await ctx.answerCallbackQuery()
      const groups = await userGroups(deps.db, userId)
      if (groups.length === 0) {
        await ctx.editMessageText('Вы пока не состоите ни в одной группе.')
        return
      }

      const chosen = data.startsWith('s:g:')
        ? groups.find((g) => g.id === Number(data.slice(4)))
        : groups.length === 1 ? groups[0] : undefined

      if (!chosen) {
        await ctx.editMessageText('Выберите группу:', {
          reply_markup: groupsKeyboard(groups, 's:g:'),
        })
        return
      }

      const report = await groupReport(deps.db, chosen.id, weekStart(day), day)
      const missing = await missingToday(deps.db, chosen.id, day)
      await ctx.editMessageText(groupScreen(report, userId, missing), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '← Назад', callback_data: 'back' }]] },
      })
      return
    }

    if (data === 'back') {
      await ctx.answerCallbackQuery()
      await showMain(ctx, deps, { edit: true })
    }
  })

  bot.on('message:text', async (ctx) => {
    const tg = ctx.from
    const user = await upsertFromTelegram(deps.db, {
      id: tg.id, username: tg.username, first_name: tg.first_name,
    })
    const text = ctx.message.text.trim()

    // 1. Нет имени — всё, что человек пишет, считается ответом на вопрос об имени.
    if (!user.display_name) {
      if (text === '/start') {
        await ctx.reply('Здравствуйте! Как вас зовут? Напишите имя и фамилию — так в группе поймут, кто вы.')
        return
      }
      const res = await setDisplayName(deps.db, tg.id, text, { byAdmin: false })
      if (!res.ok) {
        await ctx.reply('Напишите имя буквами, например: Айгуль Смагулова')
        return
      }
      await ctx.reply(`Приятно познакомиться, ${res.name}!`)
      await notifyAdmins(ctx, deps, res.name)
      await showMain(ctx, deps)
      return
    }

    // 2. Ждём число по конкретному трекеру.
    const pendingId = await takePending(deps.db, tg.id)
    if (pendingId !== null && !text.startsWith('/')) {
      const value = parseNumber(text)
      if (value === null) {
        await ctx.reply('Нужно число, например 12')
        return
      }
      const trackers = await activeTrackersForUser(deps.db, tg.id)
      const tracker = trackers.find((t) => t.id === pendingId)
      await clearPending(deps.db, tg.id)
      if (!tracker) {
        await ctx.reply('Трекер больше не активен')
        await showMain(ctx, deps)
        return
      }
      const day = await today(deps.db)
      const res = await setValue(deps.db, tg.id, tracker.id, day, value)
      await ctx.reply(
        res.cleared
          ? `Отметка снята: ${tracker.title}`
          : `Записано: ${num(value)} ${tracker.unit ?? ''} ${res.done ? '✅' : ''} (цель ${num(tracker.target)})`.trim(),
      )
      await showMain(ctx, deps)
      return
    }

    // 3. Смена имени.
    if (text.startsWith('/name')) {
      const raw = text.slice('/name'.length).trim()
      const res = await setDisplayName(deps.db, tg.id, raw, { byAdmin: false })
      if (res.ok) await ctx.reply(`Готово, теперь вы ${res.name}`)
      else if (res.reason === 'locked') await ctx.reply('Ваше имя задал администратор, напишите ему')
      else await ctx.reply('Напишите так: /name Айгуль Смагулова')
      return
    }

    // 4. Всё остальное открывает главный экран.
    await showMain(ctx, deps)
  })
}
```

Имя в уведомлении админам берётся из результата `setDisplayName`, а не из Telegram:
в этот момент человек только что назвал себя, и `users.display_name` уже обновлён.

- [ ] **Step 4: Написать `lib/bot.ts`**

```ts
import { Bot } from 'grammy'
import type { UserFromGetMe } from 'grammy/types'
import { registerAdmin } from './handlers/admin.ts'
import { registerUser, type BotDeps } from './handlers/user.ts'

export type { BotDeps }

export function createBot(token: string, deps: BotDeps, botInfo?: UserFromGetMe): Bot {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined)

  bot.catch((err) => {
    console.error('bot error', err.error)
    const ctx = err.ctx
    if (ctx.callbackQuery) {
      void ctx.answerCallbackQuery({ text: 'Что-то пошло не так, попробуйте ещё раз' })
    } else if (ctx.chat) {
      void ctx.reply('Что-то пошло не так, попробуйте ещё раз')
    }
  })

  registerAdmin(bot, deps)
  registerUser(bot, deps)
  return bot
}
```

`registerAdmin` появится в задаче 9 — до неё создайте файл-заглушку
`lib/handlers/admin.ts` с `export function registerAdmin(): void {}` и уберите
заглушку, когда будете писать задачу 9. Порядок важен: админские обработчики
регистрируются раньше пользовательских, потому что `message:text` в
`registerUser` перехватывает всё подряд.

- [ ] **Step 5: Запустить тесты и убедиться, что они проходят**

Run: `npm test -- tests/bot.test.ts`
Expected: PASS (6 тестов).

- [ ] **Step 6: Коммит**

```bash
git add lib/bot.ts lib/handlers tests/bot.test.ts
git commit -m "feat: bot onboarding, check-ins and stats screens"
```

---

### Task 9: Админ в боте — `/bind`

**Files:**
- Create: `lib/handlers/admin.ts` (заменяет заглушку из задачи 8)
- Test: `tests/bind.test.ts`

**Interfaces:**
- Consumes: `BotDeps`, `listGroups`, `bindChat`, `groupsKeyboard`.
- Produces: `registerAdmin(bot: Bot, deps: BotDeps): void`

- [ ] **Step 1: Написать падающий тест `tests/bind.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import type { Update } from 'grammy/types'
import { createBot } from '../lib/bot.ts'
import { createGroup, listGroups } from '../lib/groups.ts'
import { testDb } from './helpers.ts'

const BOT_INFO = {
  id: 42, is_bot: true as const, first_name: 'Tracker', username: 'tracker_bot',
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
  can_connect_to_business: false, has_main_web_app: false,
}

async function harness() {
  const db = await testDb()
  const calls: { method: string; payload: Record<string, unknown> }[] = []
  const bot = createBot('42:TEST', { db, adminIds: [99], appUrl: 'https://example.com' }, BOT_INFO)
  bot.api.config.use(async (_p, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> })
    return { ok: true, result: { message_id: 1 } } as never
  })
  await bot.init()
  return { db, bot, calls }
}

function groupMessage(text: string, fromId: number, chatId = -100500): Update {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: 1, date: 0, text,
      chat: { id: chatId, type: 'supergroup' as const, title: 'Утро' },
      from: { id: fromId, is_bot: false, first_name: 'Админ' },
    },
  } as Update
}

function groupTap(data: string, fromId: number, chatId = -100500): Update {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: {
      id: 'cb', chat_instance: 'x', data,
      from: { id: fromId, is_bot: false, first_name: 'Админ' },
      message: {
        message_id: 2, date: 0, text: 'выбор',
        chat: { id: chatId, type: 'supergroup' as const, title: 'Утро' },
      },
    },
  } as Update
}

describe('/bind', () => {
  it('админ выбирает группу кнопкой, чат привязывается', async () => {
    const { db, bot, calls } = await harness()
    const g = await createGroup(db, 'Утро')

    await bot.handleUpdate(groupMessage('/bind', 99))
    expect(JSON.stringify(calls.at(-1)?.payload.reply_markup)).toContain(`b:${g.id}`)

    await bot.handleUpdate(groupTap(`b:${g.id}`, 99))
    expect((await listGroups(db))[0].chat_id).toBe(-100500)
  })

  it('не-админа игнорирует', async () => {
    const { db, bot, calls } = await harness()
    await createGroup(db, 'Утро')

    await bot.handleUpdate(groupMessage('/bind', 7))
    expect(calls).toHaveLength(0)
    expect((await listGroups(db))[0].chat_id).toBeNull()
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm test -- tests/bind.test.ts`
Expected: FAIL — заглушка `registerAdmin` ничего не делает.

- [ ] **Step 3: Написать `lib/handlers/admin.ts`**

```ts
import type { Bot } from 'grammy'
import { bindChat, listGroups } from '../groups.ts'
import { groupsKeyboard } from '../menu.ts'
import type { BotDeps } from './user.ts'

export function registerAdmin(bot: Bot, deps: BotDeps): void {
  bot.command('bind', async (ctx) => {
    if (!deps.adminIds.includes(ctx.from!.id)) return
    const groups = await listGroups(deps.db)
    if (groups.length === 0) {
      await ctx.reply('Сначала создайте группу в админке.')
      return
    }
    await ctx.reply('К какой группе привязать этот чат?', {
      reply_markup: groupsKeyboard(groups, 'b:'),
    })
  })

  bot.callbackQuery(/^b:(\d+)$/, async (ctx) => {
    if (!deps.adminIds.includes(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: 'Только для админов' })
      return
    }
    const groupId = Number(ctx.match![1])
    const chatId = ctx.chat!.id
    await bindChat(deps.db, groupId, chatId)
    const group = (await listGroups(deps.db)).find((g) => g.id === groupId)
    await ctx.answerCallbackQuery({ text: 'Привязано' })
    await ctx.editMessageText(`Чат привязан к группе «${group?.title ?? groupId}». Итоги недели буду присылать сюда по воскресеньям.`)
  })
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npm test -- tests/bind.test.ts tests/bot.test.ts`
Expected: PASS. Если пользовательский `message:text` перехватил `/bind` — проверьте, что `registerAdmin` вызывается раньше `registerUser` в `lib/bot.ts`.

- [ ] **Step 5: Коммит**

```bash
git add lib/handlers/admin.ts tests/bind.test.ts
git commit -m "feat: /bind links a group chat"
```

---

### Task 10: Вебхук и установка

**Files:**
- Create: `lib/webhook.ts`, `lib/runtime.ts`, `app/api/telegram/route.ts`, `app/api/setup/route.ts`
- Test: `tests/webhook.test.ts`

**Interfaces:**
- Consumes: `config`, `neonDb`, `createBot`, `claimUpdate`, `migrate`.
- Produces:
  - `getDb(): Db` и `getBot(): Bot` в `lib/runtime.ts` — ленивые синглтоны на процесс (переживают тёплый старт функции)
  - `handleWebhook(req: Request, deps: { db; bot; secret }): Promise<Response>` в `lib/webhook.ts` — вся логика вебхука, чтобы её можно было протестировать без Next

- [ ] **Step 1: Написать падающий тест `tests/webhook.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest'
import { handleWebhook } from '../lib/webhook.ts'
import { testDb } from './helpers.ts'

function req(body: unknown, secret?: string): Request {
  return new Request('https://example.com/api/telegram', {
    method: 'POST',
    headers: secret ? { 'X-Telegram-Bot-Api-Secret-Token': secret } : {},
    body: JSON.stringify(body),
  })
}

describe('handleWebhook', () => {
  it('без правильного секрета отвечает 401 и не трогает бота', async () => {
    const db = await testDb()
    const bot = { handleUpdate: vi.fn() }
    const res = await handleWebhook(req({ update_id: 1 }), { db, bot: bot as never, secret: 'S' })
    expect(res.status).toBe(401)
    expect(bot.handleUpdate).not.toHaveBeenCalled()
  })

  it('обрабатывает апдейт один раз, повтор проглатывает', async () => {
    const db = await testDb()
    const bot = { handleUpdate: vi.fn() }
    const deps = { db, bot: bot as never, secret: 'S' }

    expect((await handleWebhook(req({ update_id: 5 }, 'S'), deps)).status).toBe(200)
    expect((await handleWebhook(req({ update_id: 5 }, 'S'), deps)).status).toBe(200)
    expect(bot.handleUpdate).toHaveBeenCalledTimes(1)
  })

  it('исключение в обработчике всё равно даёт 200', async () => {
    const db = await testDb()
    const bot = { handleUpdate: vi.fn().mockRejectedValue(new Error('bang')) }
    const res = await handleWebhook(req({ update_id: 9 }, 'S'), { db, bot: bot as never, secret: 'S' })
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm test -- tests/webhook.test.ts`
Expected: FAIL — нет `lib/webhook.ts`.

- [ ] **Step 3: Написать `lib/webhook.ts`**

```ts
import type { Update } from 'grammy/types'
import type { Db } from './db.ts'
import { claimUpdate } from './entries.ts'

type UpdateHandler = { handleUpdate(update: Update): Promise<void> }

export async function handleWebhook(
  req: Request,
  deps: { db: Db; bot: UpdateHandler; secret: string },
): Promise<Response> {
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== deps.secret) {
    return new Response('unauthorized', { status: 401 })
  }

  const update = (await req.json()) as Update
  if (!(await claimUpdate(deps.db, update.update_id))) return new Response('duplicate')

  try {
    await deps.bot.handleUpdate(update)
  } catch (err) {
    // Ретрай Telegram уже отсечён таблицей processed — отвечаем 200 и живём дальше.
    console.error('handleUpdate failed', err)
  }
  return new Response('ok')
}
```

- [ ] **Step 4: Написать `lib/runtime.ts` и роуты**

`lib/runtime.ts`:

```ts
import type { Bot } from 'grammy'
import { createBot } from './bot.ts'
import { config } from './config.ts'
import { neonDb, type Db } from './db.ts'

let db: Db | null = null
let bot: Bot | null = null

export function getDb(): Db {
  db ??= neonDb(config.databaseUrl(), config.tz())
  return db
}

export function getBot(): Bot {
  bot ??= createBot(config.botToken(), {
    db: getDb(), adminIds: config.adminIds(), appUrl: config.appUrl(),
  })
  return bot
}
```

`app/api/telegram/route.ts`:

```ts
import { config } from '@/lib/config.ts'
import { getBot, getDb } from '@/lib/runtime.ts'
import { handleWebhook } from '@/lib/webhook.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const bot = getBot()
  await bot.init()
  return handleWebhook(req, { db: getDb(), bot, secret: config.webhookSecret() })
}
```

`app/api/setup/route.ts`:

```ts
import { config } from '@/lib/config.ts'
import { migrate } from '@/lib/db.ts'
import { getBot, getDb } from '@/lib/runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const key = new URL(req.url).searchParams.get('key')
  if (key !== config.setupSecret()) return new Response('unauthorized', { status: 401 })

  await migrate(getDb())

  const bot = getBot()
  await bot.init()
  await bot.api.setWebhook(`${config.appUrl()}/api/telegram`, {
    secret_token: config.webhookSecret(),
    allowed_updates: ['message', 'callback_query'],
  })
  await bot.api.setChatMenuButton({
    menu_button: { type: 'web_app', text: 'Админка', web_app: { url: `${config.appUrl()}/admin` } },
  })

  return Response.json({ ok: true })
}
```

- [ ] **Step 5: Запустить тесты и проверить сборку**

Run: `npm test -- tests/webhook.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add lib/webhook.ts lib/runtime.ts app/api tests/webhook.test.ts
git commit -m "feat: telegram webhook and setup route"
```

---

### Task 11: Авторизация Mini App и валидация

**Files:**
- Create: `lib/auth.ts`, `lib/validate.ts`
- Test: `tests/auth.test.ts`, `tests/validate.test.ts`

**Interfaces:**
- Produces (`lib/auth.ts`):
  - `type TgUser = { id: number; username?: string; first_name?: string }`
  - `verifyInitData(initData: string, botToken: string, opts?: { maxAgeSec?: number; now?: number }): TgUser | null`
  - `requireAdmin(req: Request, opts: { botToken: string; adminIds: number[]; devAdminId?: number; now?: number }): TgUser | null` (`now` — только для тестов)
- Produces (`lib/validate.ts`):
  - `title(raw: unknown): string` — бросает `BadRequest` при провале
  - `id(raw: unknown): number`
  - `flag(raw: unknown): boolean`
  - `trackerInput(raw: unknown): { title: string; kind: 'check' | 'number'; target: number; unit: string | null }`
  - `class BadRequest extends Error`

- [ ] **Step 1: Написать падающий тест `tests/auth.test.ts`**

```ts
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { requireAdmin, verifyInitData } from '../lib/auth.ts'

const TOKEN = '42:TESTTOKEN'

function signInitData(user: object, authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'AAA',
    user: JSON.stringify(user),
  })
  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest()
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'))
  return params.toString()
}

const NOW = 1_800_000_000

describe('verifyInitData', () => {
  it('пропускает валидную подпись и возвращает пользователя', () => {
    const data = signInitData({ id: 99, first_name: 'Админ' }, NOW - 60)
    expect(verifyInitData(data, TOKEN, { now: NOW })).toMatchObject({ id: 99 })
  })

  it('отвергает испорченный hash', () => {
    const data = signInitData({ id: 99 }, NOW - 60).replace(/hash=\w/, 'hash=0')
    expect(verifyInitData(data, TOKEN, { now: NOW })).toBeNull()
  })

  it('отвергает подпись старше суток', () => {
    const data = signInitData({ id: 99 }, NOW - 86_401)
    expect(verifyInitData(data, TOKEN, { now: NOW })).toBeNull()
  })

  it('отвергает подпись, сделанную другим токеном', () => {
    const data = signInitData({ id: 99 }, NOW - 60)
    expect(verifyInitData(data, '42:OTHER', { now: NOW })).toBeNull()
  })
})

describe('requireAdmin', () => {
  const headers = (initData: string) => new Request('https://x/api', { headers: { 'X-Init-Data': initData } })

  it('пускает админа', () => {
    const req = headers(signInitData({ id: 99 }, NOW - 60))
    expect(requireAdmin(req, { botToken: TOKEN, adminIds: [99], now: NOW })).toMatchObject({ id: 99 })
  })

  it('не пускает валидного, но не-админа', () => {
    const req = headers(signInitData({ id: 7 }, NOW - 60))
    expect(requireAdmin(req, { botToken: TOKEN, adminIds: [99], now: NOW })).toBeNull()
  })

  it('devAdminId работает без подписи', () => {
    const req = new Request('https://x/api')
    expect(requireAdmin(req, { botToken: TOKEN, adminIds: [], devAdminId: 5 })).toMatchObject({ id: 5 })
  })
})
```

- [ ] **Step 2: Написать падающий тест `tests/validate.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { BadRequest, id, title, trackerInput } from '../lib/validate.ts'

describe('validate', () => {
  it('title чистит и проверяет длину', () => {
    expect(title('  Утро  ')).toBe('Утро')
    expect(() => title('')).toThrow(BadRequest)
    expect(() => title('x'.repeat(61))).toThrow(BadRequest)
  })

  it('id принимает только положительные целые', () => {
    expect(id(5)).toBe(5)
    expect(id('5')).toBe(5)
    expect(() => id(0)).toThrow(BadRequest)
    expect(() => id('abc')).toThrow(BadRequest)
  })

  it('trackerInput требует цель и единицу у числового', () => {
    expect(trackerInput({ title: 'Зарядка', kind: 'check' })).toEqual({
      title: 'Зарядка', kind: 'check', target: 1, unit: null,
    })
    expect(trackerInput({ title: 'Страницы', kind: 'number', target: 10, unit: 'стр.' })).toEqual({
      title: 'Страницы', kind: 'number', target: 10, unit: 'стр.',
    })
    expect(() => trackerInput({ title: 'Страницы', kind: 'number', target: 0, unit: 'стр.' })).toThrow(BadRequest)
    expect(() => trackerInput({ title: 'Страницы', kind: 'number', target: 10 })).toThrow(BadRequest)
    expect(() => trackerInput({ title: 'X', kind: 'weird' })).toThrow(BadRequest)
  })
})
```

- [ ] **Step 3: Запустить оба теста и убедиться, что они падают**

Run: `npm test -- tests/auth.test.ts tests/validate.test.ts`
Expected: FAIL.

- [ ] **Step 4: Написать `lib/auth.ts`**

```ts
import crypto from 'node:crypto'

export type TgUser = { id: number; username?: string; first_name?: string }

export function verifyInitData(
  initData: string,
  botToken: string,
  opts: { maxAgeSec?: number; now?: number } = {},
): TgUser | null {
  const maxAge = opts.maxAgeSec ?? 86_400
  const now = opts.now ?? Math.floor(Date.now() / 1000)

  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const dcs = [...params.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
  const calc = crypto.createHmac('sha256', secret).update(dcs).digest('hex')

  const a = Buffer.from(calc, 'hex')
  const b = Buffer.from(hash, 'hex')
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

  const authDate = Number(params.get('auth_date'))
  if (!Number.isFinite(authDate) || now - authDate > maxAge) return null

  try {
    const user = JSON.parse(params.get('user') ?? 'null') as TgUser | null
    return user && Number.isFinite(user.id) ? user : null
  } catch {
    return null
  }
}

export function requireAdmin(
  req: Request,
  opts: { botToken: string; adminIds: number[]; devAdminId?: number; now?: number },
): TgUser | null {
  if (opts.devAdminId) return { id: opts.devAdminId, first_name: 'dev' }

  const initData = req.headers.get('X-Init-Data')
  if (!initData) return null

  const user = verifyInitData(initData, opts.botToken, { now: opts.now })
  if (!user || !opts.adminIds.includes(user.id)) return null
  return user
}
```

- [ ] **Step 5: Написать `lib/validate.ts`**

```ts
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

export function trackerInput(raw: unknown): {
  title: string; kind: 'check' | 'number'; target: number; unit: string | null
} {
  const o = (raw ?? {}) as Record<string, unknown>
  const kind = o.kind
  if (kind !== 'check' && kind !== 'number') throw new BadRequest('Тип: галочка или число')

  if (kind === 'check') return { title: title(o.title), kind, target: 1, unit: null }

  const target = Number(o.target)
  if (!Number.isFinite(target) || target <= 0) throw new BadRequest('Цель должна быть больше нуля')
  const unit = String(o.unit ?? '').trim()
  if (!unit) throw new BadRequest('Укажите единицу измерения, например «стр.»')
  return { title: title(o.title), kind, target, unit }
}
```

- [ ] **Step 6: Запустить тесты и убедиться, что они проходят**

Run: `npm test -- tests/auth.test.ts tests/validate.test.ts`
Expected: PASS.

- [ ] **Step 7: Коммит**

```bash
git add lib/auth.ts lib/validate.ts tests/auth.test.ts tests/validate.test.ts
git commit -m "feat: Mini App initData auth and input validation"
```

---

### Task 12: Админские операции и роуты

**Files:**
- Create: `lib/admin.ts`, `lib/admin-guard.ts`, `app/api/admin/bootstrap/route.ts`, `app/api/admin/users/route.ts`, `app/api/admin/groups/route.ts`, `app/api/admin/trackers/route.ts`, `app/api/admin/stats/route.ts`
- Test: `tests/admin.test.ts`

**Interfaces:**
- Consumes: `lib/users.ts`, `lib/groups.ts`, `lib/trackers.ts`, `lib/group-stats.ts`, `lib/validate.ts`.
- Produces:
  - `type Bootstrap = { groups: Group[]; trackers: (Tracker & { group_ids: number[] })[]; users: (User & { group_ids: number[] })[] }`
  - `bootstrap(db): Promise<Bootstrap>`
  - `usersAction(db, body: unknown): Promise<Bootstrap['users']>`
  - `groupsAction(db, body: unknown): Promise<{ groups: Group[]; trackers: Bootstrap['trackers'] }>`
  - `trackersAction(db, body: unknown): Promise<Bootstrap['trackers']>`
  - `statsQuery(db, params: { groupId: number; period: 'week' | 'month'; today: string }): Promise<GroupReport>`

- [ ] **Step 1: Написать падающий тест `tests/admin.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { bootstrap, groupsAction, statsQuery, trackersAction, usersAction } from '../lib/admin.ts'
import { toggleCheck } from '../lib/entries.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { BadRequest } from '../lib/validate.ts'
import { testDb } from './helpers.ts'

describe('bootstrap', () => {
  it('отдаёт группы, трекеры и людей одним куском', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Айгуль' })
    await groupsAction(db, { action: 'create', title: 'Утро' })

    const data = await bootstrap(db)
    expect(data.groups.map((g) => g.title)).toEqual(['Утро'])
    expect(data.users.map((u) => u.id)).toEqual([7])
    expect(data.users[0].group_ids).toEqual([])
  })
})

describe('usersAction', () => {
  it('назначает и снимает группу', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Айгуль' })
    const { groups } = await groupsAction(db, { action: 'create', title: 'Утро' })
    const gid = groups[0].id

    let users = await usersAction(db, { action: 'membership', userId: 7, groupId: gid, on: true })
    expect(users[0].group_ids).toEqual([gid])

    users = await usersAction(db, { action: 'membership', userId: 7, groupId: gid, on: false })
    expect(users[0].group_ids).toEqual([])
  })

  it('переименование админом ставит замок, unlockName снимает', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Ч' })

    let users = await usersAction(db, { action: 'rename', userId: 7, displayName: 'Данияр Ахметов' })
    expect(users[0]).toMatchObject({ display_name: 'Данияр Ахметов', name_locked: true })

    users = await usersAction(db, { action: 'unlockName', userId: 7 })
    expect(users[0].name_locked).toBe(false)
  })

  it('мусорное имя отвергается', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7 })
    await expect(usersAction(db, { action: 'rename', userId: 7, displayName: '!' }))
      .rejects.toBeInstanceOf(BadRequest)
  })
})

describe('trackersAction', () => {
  it('создаёт числовой трекер и привязывает его к группе', async () => {
    const db = await testDb()
    const { groups } = await groupsAction(db, { action: 'create', title: 'Утро' })
    const trackers = await trackersAction(db, {
      action: 'create', title: 'Страницы', kind: 'number', target: 10, unit: 'стр.',
    })
    expect(trackers[0]).toMatchObject({ title: 'Страницы', target: 10, unit: 'стр.' })

    const after = await groupsAction(db, {
      action: 'tracker', groupId: groups[0].id, trackerId: trackers[0].id, on: true,
    })
    expect(after.trackers[0].group_ids).toEqual([groups[0].id])
  })

  it('числовой трекер без единицы не создаётся', async () => {
    const db = await testDb()
    await expect(trackersAction(db, { action: 'create', title: 'Страницы', kind: 'number', target: 10 }))
      .rejects.toBeInstanceOf(BadRequest)
  })

  it('архивный трекер нельзя привязать к группе', async () => {
    const db = await testDb()
    const { groups } = await groupsAction(db, { action: 'create', title: 'Утро' })
    const trackers = await trackersAction(db, { action: 'create', title: 'Старое', kind: 'check' })
    await trackersAction(db, { action: 'archive', trackerId: trackers[0].id })

    await expect(groupsAction(db, {
      action: 'tracker', groupId: groups[0].id, trackerId: trackers[0].id, on: true,
    })).rejects.toBeInstanceOf(BadRequest)
  })
})

describe('statsQuery', () => {
  it('период week считает от понедельника', async () => {
    const db = await testDb()
    await upsertFromTelegram(db, { id: 7, first_name: 'Айгуль' })
    const { groups } = await groupsAction(db, { action: 'create', title: 'Утро' })
    const trackers = await trackersAction(db, { action: 'create', title: 'Зарядка', kind: 'check' })
    await groupsAction(db, {
      action: 'tracker', groupId: groups[0].id, trackerId: trackers[0].id, on: true,
    })
    await usersAction(db, { action: 'membership', userId: 7, groupId: groups[0].id, on: true })
    await db.q(`update memberships set joined_at = '2026-09-01T00:00:00Z'`)
    await db.q(`update group_trackers set linked_at = '2026-09-01T00:00:00Z'`)
    await db.q(`update trackers set created_at = '2026-01-01T00:00:00Z'`)
    await toggleCheck(db, 7, trackers[0].id, '2026-09-08')

    const rep = await statsQuery(db, { groupId: groups[0].id, period: 'week', today: '2026-09-10' })
    expect(rep.from).toBe('2026-09-07')
    expect(rep.members[0]).toMatchObject({ done: 1, expected: 4 })
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm test -- tests/admin.test.ts`
Expected: FAIL — нет `lib/admin.ts`.

- [ ] **Step 3: Написать `lib/admin.ts`**

```ts
import type { Db } from './db.ts'
import {
  archiveGroup, createGroup, listGroups, renameGroup, setMembership, unbindChat, type Group,
} from './groups.ts'
import { groupReport, type GroupReport } from './group-stats.ts'
import { monthStart, weekStart } from './stats.ts'
import {
  archiveTracker, createTracker, listTrackers, setGroupTracker, updateTracker, type Tracker,
} from './trackers.ts'
import { listUsers, setDisplayName, unlockName, type User } from './users.ts'
import { BadRequest, flag, id, title, trackerInput } from './validate.ts'

export type Bootstrap = {
  groups: Group[]
  trackers: (Tracker & { group_ids: number[] })[]
  users: (User & { group_ids: number[] })[]
}

export async function bootstrap(db: Db): Promise<Bootstrap> {
  const [groups, trackers, users] = await Promise.all([
    listGroups(db), listTrackers(db), listUsers(db),
  ])
  return { groups, trackers, users }
}

export async function usersAction(db: Db, body: unknown): Promise<Bootstrap['users']> {
  const o = (body ?? {}) as Record<string, unknown>
  const userId = id(o.userId)

  switch (o.action) {
    case 'rename': {
      const res = await setDisplayName(db, userId, String(o.displayName ?? ''), { byAdmin: true })
      if (!res.ok) throw new BadRequest('Имя: 2–40 символов, хотя бы одна буква')
      break
    }
    case 'unlockName':
      await unlockName(db, userId)
      break
    case 'membership':
      await setMembership(db, userId, id(o.groupId), flag(o.on))
      break
    default:
      throw new BadRequest('Неизвестное действие')
  }
  return listUsers(db)
}

export async function groupsAction(
  db: Db, body: unknown,
): Promise<{ groups: Group[]; trackers: Bootstrap['trackers'] }> {
  const o = (body ?? {}) as Record<string, unknown>

  switch (o.action) {
    case 'create':
      await createGroup(db, title(o.title))
      break
    case 'rename':
      await renameGroup(db, id(o.groupId), title(o.title))
      break
    case 'archive':
      await archiveGroup(db, id(o.groupId))
      break
    case 'unbindChat':
      await unbindChat(db, id(o.groupId))
      break
    case 'tracker': {
      const trackerId = id(o.trackerId)
      const on = flag(o.on)
      if (on) {
        const known = await listTrackers(db)
        if (!known.some((t) => t.id === trackerId)) {
          throw new BadRequest('Архивный трекер нельзя привязать к группе')
        }
      }
      await setGroupTracker(db, id(o.groupId), trackerId, on)
      break
    }
    default:
      throw new BadRequest('Неизвестное действие')
  }

  const [groups, trackers] = await Promise.all([listGroups(db), listTrackers(db)])
  return { groups, trackers }
}

export async function trackersAction(db: Db, body: unknown): Promise<Bootstrap['trackers']> {
  const o = (body ?? {}) as Record<string, unknown>

  switch (o.action) {
    case 'create': {
      const t = trackerInput(o)
      await createTracker(db, t)
      break
    }
    case 'update': {
      const t = trackerInput(o)
      await updateTracker(db, id(o.trackerId), { title: t.title, target: t.target, unit: t.unit })
      break
    }
    case 'archive':
      await archiveTracker(db, id(o.trackerId))
      break
    default:
      throw new BadRequest('Неизвестное действие')
  }
  return listTrackers(db)
}

export async function statsQuery(
  db: Db,
  params: { groupId: number; period: 'week' | 'month'; today: string },
): Promise<GroupReport> {
  const from = params.period === 'month' ? monthStart(params.today) : weekStart(params.today)
  return groupReport(db, params.groupId, from, params.today)
}
```

- [ ] **Step 4: Написать роуты**

Сначала общий страж. Из route-файла Next нельзя экспортировать ничего, кроме
HTTP-методов и служебных констант, поэтому проверка живёт отдельным модулем.

`lib/admin-guard.ts`:

```ts
import { requireAdmin } from './auth.ts'
import { config } from './config.ts'

export function admin(req: Request) {
  return requireAdmin(req, {
    botToken: config.botToken(),
    adminIds: config.adminIds(),
    devAdminId: config.devAdminId(),
  })
}
```

`app/api/admin/bootstrap/route.ts`:

```ts
import { bootstrap } from '@/lib/admin.ts'
import { admin } from '@/lib/admin-guard.ts'
import { getDb } from '@/lib/runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  if (!admin(req)) return Response.json({ error: 'Нет доступа' }, { status: 401 })
  return Response.json(await bootstrap(getDb()))
}
```

`app/api/admin/users/route.ts`:

```ts
import { usersAction } from '@/lib/admin.ts'
import { admin } from '@/lib/admin-guard.ts'
import { getDb } from '@/lib/runtime.ts'
import { BadRequest } from '@/lib/validate.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  if (!admin(req)) return Response.json({ error: 'Нет доступа' }, { status: 401 })
  try {
    return Response.json({ users: await usersAction(getDb(), await req.json()) })
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 })
    console.error(err)
    return Response.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
```

`app/api/admin/groups/route.ts`:

```ts
import { groupsAction } from '@/lib/admin.ts'
import { admin } from '@/lib/admin-guard.ts'
import { getDb } from '@/lib/runtime.ts'
import { BadRequest } from '@/lib/validate.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  if (!admin(req)) return Response.json({ error: 'Нет доступа' }, { status: 401 })
  try {
    return Response.json(await groupsAction(getDb(), await req.json()))
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 })
    console.error(err)
    return Response.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
```

`app/api/admin/trackers/route.ts`:

```ts
import { trackersAction } from '@/lib/admin.ts'
import { admin } from '@/lib/admin-guard.ts'
import { getDb } from '@/lib/runtime.ts'
import { BadRequest } from '@/lib/validate.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  if (!admin(req)) return Response.json({ error: 'Нет доступа' }, { status: 401 })
  try {
    return Response.json({ trackers: await trackersAction(getDb(), await req.json()) })
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 })
    console.error(err)
    return Response.json({ error: 'Внутренняя ошибка' }, { status: 500 })
  }
}
```

`app/api/admin/stats/route.ts`:

```ts
import { statsQuery } from '@/lib/admin.ts'
import { admin } from '@/lib/admin-guard.ts'
import { today } from '@/lib/db.ts'
import { getDb } from '@/lib/runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  if (!admin(req)) return Response.json({ error: 'Нет доступа' }, { status: 401 })
  const url = new URL(req.url)
  const db = getDb()
  const period = url.searchParams.get('period') === 'month' ? 'month' : 'week'
  return Response.json(await statsQuery(db, {
    groupId: Number(url.searchParams.get('groupId')),
    period,
    today: await today(db),
  }))
}
```

- [ ] **Step 5: Запустить тесты и проверить типы**

Run: `npm test -- tests/admin.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 6: Коммит**

```bash
git add lib/admin.ts lib/admin-guard.ts app/api/admin tests/admin.test.ts
git commit -m "feat: admin operations and API routes"
```

---

### Task 13: Mini App

**Files:**
- Create: `app/admin/page.tsx`, `app/admin/api.ts`, `app/admin/People.tsx`, `app/admin/Groups.tsx`, `app/admin/Trackers.tsx`, `app/admin/Dashboard.tsx`
- Modify: `app/layout.tsx` (подключить `telegram-web-app.js`)

**Interfaces:**
- Consumes: типы `Bootstrap`, `GroupReport` из `lib/`.
- Produces: страница `/admin` — четыре вкладки.

Тестами не покрывается (спека §10): вся логика в `lib/`, страница — тонкий слой.
Проверяется вручную по чек-листу в шаге 7.

- [ ] **Step 1: Подключить скрипт Telegram в `app/layout.tsx`**

В `<head>` добавить:

```tsx
<script src="https://telegram.org/js/telegram-web-app.js" async />
```

- [ ] **Step 2: Написать `app/admin/api.ts`**

```ts
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
```

- [ ] **Step 3: Написать `app/admin/page.tsx`**

```tsx
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
```

- [ ] **Step 4: Написать `app/admin/People.tsx`**

```tsx
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
```

- [ ] **Step 5: Написать `app/admin/Groups.tsx` и `app/admin/Trackers.tsx`**

`Groups.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { Bootstrap } from '@/lib/admin.ts'

export default function Groups(props: {
  data: Bootstrap
  onAction: (body: object) => void
}) {
  const { data } = props
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
          className="rounded bg-blue-600 px-3 text-sm text-white"
          onClick={() => { props.onAction({ action: 'create', title }); setTitle('') }}
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
              <button className="text-xs opacity-60" onClick={() => props.onAction({ action: 'archive', groupId: g.id })}>
                архивировать
              </button>
            </div>

            <div className="mt-1 text-xs opacity-70">
              {g.chat_id
                ? <>Чат привязан · <button onClick={() => props.onAction({ action: 'unbindChat', groupId: g.id })}>отвязать</button></>
                : 'Чат не привязан — напишите /bind в чате группы'}
              {' · '}участников: {members.length}
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {data.trackers.map((t) => {
                const on = t.group_ids.includes(g.id)
                return (
                  <button
                    key={t.id}
                    onClick={() => props.onAction({ action: 'tracker', groupId: g.id, trackerId: t.id, on: !on })}
                    className={`rounded-full border px-2 py-1 text-xs ${
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
```

`Trackers.tsx`:

```tsx
'use client'

import { useState } from 'react'
import type { Bootstrap } from '@/lib/admin.ts'

export default function Trackers(props: { data: Bootstrap; onAction: (body: object) => void }) {
  const { data } = props
  const [form, setForm] = useState({ title: '', kind: 'check' as 'check' | 'number', target: '10', unit: '' })

  const groupTitle = (id: number) => data.groups.find((g) => g.id === id)?.title ?? `#${id}`

  return (
    <div className="space-y-3">
      <section className="space-y-2 rounded-xl border border-black/10 p-3 dark:border-white/15">
        <input
          className="w-full rounded border border-black/20 px-2 py-1 text-sm dark:border-white/20 dark:bg-transparent"
          placeholder="Название трекера"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <div className="flex gap-2 text-sm">
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
            className="ml-auto rounded bg-blue-600 px-3 text-white"
            onClick={() => {
              props.onAction({
                action: 'create', title: form.title, kind: form.kind,
                target: Number(form.target), unit: form.unit,
              })
              setForm({ title: '', kind: 'check', target: '10', unit: '' })
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
            <button className="text-xs opacity-60" onClick={() => props.onAction({ action: 'archive', trackerId: t.id })}>
              архивировать
            </button>
          </div>
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
```

- [ ] **Step 6: Написать `app/admin/Dashboard.tsx`**

```tsx
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
```

- [ ] **Step 7: Проверить руками**

Run: `npx tsc --noEmit` — без ошибок.
Run: `npm run build` — сборка Next проходит.
Run: `DEV_ADMIN_ID=<ваш id> npm run dev`, открыть `http://localhost:3000/admin` и проверить:
создание группы и трекера; чипсы групп в «Людях» включаются и выключаются; переименование
человека ставит замок; вкладка «Дашборд» рисует карту дней. Для данных завести пару людей
через локального бота (`npm run bot`).

- [ ] **Step 8: Коммит**

```bash
git add app/admin app/layout.tsx
git commit -m "feat: Mini App admin panel"
```

---

### Task 14: Напоминание, воскресный отчёт и деплой

**Files:**
- Create: `lib/report.ts`, `app/api/cron/reminder/route.ts`, `app/api/cron/weekly/route.ts`, `vercel.json`, `scripts/dev-bot.ts`, `README.md`
- Test: `tests/report.test.ts`

**Interfaces:**
- Consumes: `usersWithUnfinished`, `groupReport`, `listGroups`, `weekStart`, `activeTrackersForUser`, `dayState`, `mainScreen`.
- Produces:
  - `claimSend(db, kind: 'remind' | 'weekly', key: string): Promise<boolean>`
  - `weeklyText(report: GroupReport): string`
  - `reminderText(count: number): string`
  - `sendReminders(db, sender: Sender, today: string): Promise<number>`
  - `sendWeekly(db, sender: Sender, today: string): Promise<number>`
  - `type Sender = { send(chatId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<void> }`

- [ ] **Step 1: Написать падающий тест `tests/report.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { toggleCheck } from '../lib/entries.ts'
import { bindChat, createGroup, setMembership } from '../lib/groups.ts'
import { claimSend, sendReminders, sendWeekly, weeklyText } from '../lib/report.ts'
import { createTracker, setGroupTracker } from '../lib/trackers.ts'
import { upsertFromTelegram } from '../lib/users.ts'
import { groupReport } from '../lib/group-stats.ts'
import { testDb } from './helpers.ts'

const TODAY = '2026-09-13' // воскресенье

async function fixture() {
  const db = await testDb()
  await upsertFromTelegram(db, { id: 1, first_name: 'Айгуль' })
  await upsertFromTelegram(db, { id: 2, first_name: 'Данияр' })
  const g = await createGroup(db, 'Утро')
  const charge = await createTracker(db, { title: 'Зарядка', kind: 'check' })
  await setGroupTracker(db, g.id, charge.id, true)
  await setMembership(db, 1, g.id, true)
  await setMembership(db, 2, g.id, true)
  await db.q(`update memberships set joined_at = '2026-09-01T00:00:00Z'`)
  await db.q(`update group_trackers set linked_at = '2026-09-01T00:00:00Z'`)
  await db.q(`update trackers set created_at = '2026-01-01T00:00:00Z'`)
  return { db, g, charge }
}

function recorder() {
  const sent: { chatId: number; text: string }[] = []
  return {
    sent,
    sender: { send: async (chatId: number, text: string) => { sent.push({ chatId, text }) } },
  }
}

describe('claimSend', () => {
  it('пропускает первый вызов и блокирует повтор', async () => {
    const { db } = await fixture()
    expect(await claimSend(db, 'weekly', '2026-09-07:1')).toBe(true)
    expect(await claimSend(db, 'weekly', '2026-09-07:1')).toBe(false)
  })
})

describe('sendReminders', () => {
  it('пишет только тем, у кого остались незакрытые трекеры', async () => {
    const { db, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, TODAY)
    const { sent, sender } = recorder()

    expect(await sendReminders(db, sender, TODAY)).toBe(1)
    expect(sent.map((s) => s.chatId)).toEqual([2])
    expect(sent[0].text).toContain('Осталось на сегодня')
  })

  it('повторный запуск в тот же день не шлёт второе сообщение', async () => {
    const { db } = await fixture()
    const { sent, sender } = recorder()
    await sendReminders(db, sender, TODAY)
    await sendReminders(db, sender, TODAY)
    expect(sent.filter((s) => s.chatId === 2)).toHaveLength(1)
  })

  it('падение отправки одному не мешает остальным', async () => {
    const { db } = await fixture()
    const sent: number[] = []
    const sender = {
      send: async (chatId: number) => {
        if (chatId === 1) throw new Error('bot was blocked by the user')
        sent.push(chatId)
      },
    }
    expect(await sendReminders(db, sender, TODAY)).toBe(1)
    expect(sent).toEqual([2])
  })
})

describe('sendWeekly', () => {
  it('шлёт отчёт в чат группы и не повторяется', async () => {
    const { db, g, charge } = await fixture()
    await bindChat(db, g.id, -100500)
    await toggleCheck(db, 1, charge.id, '2026-09-08')
    const { sent, sender } = recorder()

    expect(await sendWeekly(db, sender, TODAY)).toBe(1)
    expect(sent[0].chatId).toBe(-100500)
    expect(sent[0].text).toContain('итоги недели')
    expect(await sendWeekly(db, sender, TODAY)).toBe(0)
  })

  it('группу без чата пропускает', async () => {
    const { db } = await fixture()
    const { sent, sender } = recorder()
    expect(await sendWeekly(db, sender, TODAY)).toBe(0)
    expect(sent).toEqual([])
  })
})

describe('weeklyText', () => {
  it('содержит проценты участников и итог по группе', async () => {
    const { db, g, charge } = await fixture()
    await toggleCheck(db, 1, charge.id, '2026-09-08')
    const text = weeklyText(await groupReport(db, g.id, '2026-09-07', TODAY))
    expect(text).toContain('Айгуль')
    expect(text).toContain('Группа в среднем')
  })
})
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

Run: `npm test -- tests/report.test.ts`
Expected: FAIL — нет `lib/report.ts`.

- [ ] **Step 3: Написать `lib/report.ts`**

```ts
import type { InlineKeyboardMarkup } from 'grammy/types'
import type { Db } from './db.ts'
import { dayState } from './entries.ts'
import { listGroups } from './groups.ts'
import { groupReport, usersWithUnfinished, type GroupReport } from './group-stats.ts'
import { mainScreen } from './menu.ts'
import { weekStart } from './stats.ts'
import { activeTrackersForUser } from './trackers.ts'
import { bar, formatRange, num, padRight } from './text.ts'

export type Sender = {
  send(chatId: number, text: string, keyboard?: InlineKeyboardMarkup): Promise<void>
}

export async function claimSend(
  db: Db, kind: 'remind' | 'weekly', key: string,
): Promise<boolean> {
  const rows = await db.q(
    `insert into sent_log (kind, key) values ($1, $2) on conflict do nothing returning key`,
    [kind, key],
  )
  return rows.length > 0
}

export function reminderText(count: number): string {
  const word = count === 1 ? 'трекер' : count < 5 ? 'трекера' : 'трекеров'
  return `Осталось на сегодня: ${count} ${word}. Отметьте, пока день не кончился.`
}

export async function sendReminders(db: Db, sender: Sender, today: string): Promise<number> {
  const targets = await usersWithUnfinished(db, today)
  let sent = 0

  for (const { user_id, count } of targets) {
    if (!(await claimSend(db, 'remind', `${today}:${user_id}`))) continue
    try {
      const trackers = await activeTrackersForUser(db, user_id)
      const state = await dayState(db, user_id, today)
      const { keyboard } = mainScreen({ day: today, trackers, state })
      await sender.send(user_id, reminderText(count), keyboard)
      sent += 1
    } catch (err) {
      // Человек заблокировал бота — рассылка остальным продолжается.
      console.error('reminder failed', user_id, err)
    }
  }
  return sent
}

export function weeklyText(report: GroupReport): string {
  const width = Math.max(...report.members.map((m) => m.name.length), 6) + 1
  const rows = report.members
    .slice()
    .sort((a, b) => b.percent - a.percent)
    .map((m) => `${padRight(m.name, width)}${bar(m.percent)} ${String(m.percent).padStart(3)}%`)

  const numbers = report.trackers
    .filter((t) => t.kind === 'number' && t.sum > 0)
    .map((t) => `${t.title}: ${num(t.sum)} ${t.unit ?? ''} за неделю`)

  return [
    `🏁 <b>${report.title}</b> · итоги недели ${formatRange(report.from, report.to)}`,
    `<pre>${rows.join('\n')}</pre>`,
    `Группа в среднем: ${report.percent}%`,
    report.trackers.map((t) => `${t.title} ${t.percent}%`).join(' · '),
    ...numbers,
  ].filter(Boolean).join('\n')
}

export async function sendWeekly(db: Db, sender: Sender, today: string): Promise<number> {
  const from = weekStart(today)
  let sent = 0

  for (const group of await listGroups(db)) {
    if (!group.chat_id) {
      console.log(`группа ${group.id} без чата — отчёт пропущен`)
      continue
    }
    if (!(await claimSend(db, 'weekly', `${from}:${group.id}`))) continue
    try {
      const report = await groupReport(db, group.id, from, today)
      if (report.members.length === 0) continue
      await sender.send(group.chat_id, weeklyText(report))
      sent += 1
    } catch (err) {
      console.error('weekly failed', group.id, err)
    }
  }
  return sent
}
```

- [ ] **Step 4: Запустить тесты и убедиться, что они проходят**

Run: `npm test -- tests/report.test.ts`
Expected: PASS.

- [ ] **Step 5: Написать cron-роуты**

`app/api/cron/reminder/route.ts`:

```ts
import { config } from '@/lib/config.ts'
import { today } from '@/lib/db.ts'
import { sendReminders } from '@/lib/report.ts'
import { getBot, getDb } from '@/lib/runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  if (req.headers.get('Authorization') !== `Bearer ${config.cronSecret()}`) {
    return new Response('unauthorized', { status: 401 })
  }

  const db = getDb()
  const bot = getBot()
  await bot.init()

  const sent = await sendReminders(db, {
    send: async (chatId, text, keyboard) => {
      await bot.api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
      })
    },
  }, await today(db))

  return Response.json({ sent })
}
```

`app/api/cron/weekly/route.ts`:

```ts
import { config } from '@/lib/config.ts'
import { today } from '@/lib/db.ts'
import { sendWeekly } from '@/lib/report.ts'
import { getBot, getDb } from '@/lib/runtime.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  if (req.headers.get('Authorization') !== `Bearer ${config.cronSecret()}`) {
    return new Response('unauthorized', { status: 401 })
  }

  const db = getDb()
  const bot = getBot()
  await bot.init()

  const sent = await sendWeekly(db, {
    send: async (chatId, text) => {
      await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' })
    },
  }, await today(db))

  return Response.json({ sent })
}
```

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/reminder", "schedule": "0 16 * * *" },
    { "path": "/api/cron/weekly", "schedule": "0 15 * * 0" }
  ]
}
```

Выражения в UTC. `0 16 * * *` — это 21:00 в `Asia/Almaty`; `0 15 * * 0` — воскресенье,
20:00 там же. На тарифе Hobby срабатывание плавает в пределах часа. При смене `TZ`
правьте оба выражения.

- [ ] **Step 6: Написать `scripts/dev-bot.ts` и `README.md`**

`scripts/dev-bot.ts`:

```ts
import { createBot } from '../lib/bot.ts'
import { config } from '../lib/config.ts'
import { migrate, neonDb } from '../lib/db.ts'

const db = neonDb(config.databaseUrl(), config.tz())
await migrate(db)

const bot = createBot(config.botToken(), {
  db, adminIds: config.adminIds(), appUrl: config.appUrl(),
})

await bot.api.deleteWebhook()
console.log('long polling запущен, Ctrl+C для выхода')
await bot.start()
```

`README.md` — раздел «Развёртывание» из спеки §11 плюс список переменных окружения из §3
и напоминание переименовать локальные `bot_token`/`admin_id` в `BOT_TOKEN`/`ADMIN_IDS`.

- [ ] **Step 7: Прогнать всё**

Run: `npm test`
Expected: PASS, все файлы тестов.
Run: `npx tsc --noEmit && npm run build`
Expected: без ошибок.

- [ ] **Step 8: Коммит**

```bash
git add lib/report.ts app/api/cron vercel.json scripts README.md tests/report.test.ts
git commit -m "feat: evening reminders, weekly group reports and deploy config"
```

- [ ] **Step 9: Развернуть**

1. `npm i -g vercel && vercel link`
2. `vercel integration add neon` — `DATABASE_URL` появится в проекте
3. `vercel env add` для `BOT_TOKEN`, `ADMIN_IDS`, `TZ`, `WEBHOOK_SECRET`, `SETUP_SECRET`, `CRON_SECRET`, `APP_URL`
4. `vercel deploy --prod`
5. `curl "https://<домен>/api/setup?key=<SETUP_SECRET>"` — миграции, вебхук, кнопка меню
6. Добавить бота в чат каждой группы, написать там `/bind`
7. Проверить в Telegram: `/start` → имя → админ получает уведомление → назначить группы в Mini App → трекеры появились в меню

---

## Проверка плана против спеки

| Раздел спеки | Задачи |
|---|---|
| §3 Архитектура, переменные окружения | 1, 10 |
| §4 Данные, правила модели | 1, 3, 4 |
| §5 Статистика | 5, 6 |
| §6 Бот: онбординг, имя, экраны, `/bind` | 2, 7, 8, 9 |
| §7 Mini App: доступ, экраны, API | 11, 12, 13 |
| §8 Расписания | 14 |
| §9 Надёжность: секрет вебхука, setup, ошибки, ретрай Neon | 1, 10 |
| §10 Тестирование | тесты в каждой задаче |
| §11 Развёртывание | 14 |

