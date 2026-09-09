# Telegram Habit Tracker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telegram-бот на Vercel: участники одним тапом отмечают привычки за сегодня, админ выдаёт доступ, ведёт трекеры и смотрит статистику (сегодня / месяц / серия / пропуски).

**Architecture:** Одна Vercel-функция `api/bot.js` принимает вебхук, проверяет секрет, дедуплицирует `update_id` и передаёт апдейт в grammY. Вся логика в `lib/`: слой данных (`db.js`, `users.js`, `trackers.js`, `checkins.js`), статистика на SQL (`stats.js`), сборка меню и текстов, хендлеры участника и админа. Прод-БД — Neon Postgres через HTTP-драйвер; тесты гоняются на PGlite (встроенный Postgres в WASM) через тот же интерфейс `q(text, params) → rows`.

**Tech Stack:** Node.js ≥ 22 (ESM), grammy 1.46, @neondatabase/serverless 1.1, vitest 5, @electric-sql/pglite 0.5 (только тесты), Vercel Functions.

**Spec:** `docs/superpowers/specs/2026-09-10-telegram-habit-tracker-design.md`

## Global Constraints

- `package.json` с `"type": "module"`; только ESM-импорты с расширением `.js`.
- Зависимости прода — ровно две: `grammy`, `@neondatabase/serverless`. Dev: `vitest`, `@electric-sql/pglite`. Никаких dotenv, ORM, date-библиотек.
- Все даты пересекают границу SQL ↔ JS **только строками** `YYYY-MM-DD`: в SQL всегда `::date::text` наружу и `$n::date` внутрь. Никаких JS `Date` в слое данных.
- Все агрегаты в SQL кастуются `::int` (иначе `count(*)` приходит строкой).
- «Сегодня» вычисляется в SQL: `(now() AT TIME ZONE $tz)::date`. Функции статистики и тоггла получают `today` параметром — источник истины один (`today(db)`), но тесты фиксируют дату.
- Все тексты бота — на русском. Callback data: `t:<id>` тап по трекеру, `u:allow:<id>` / `u:deny:<id>` доступ, `d:<id>` / `d:<id>:yes` / `d:cancel` архивирование.
- Вебхук всегда отвечает 200 после проверки секрета, даже при исключении.
- Коммит после каждой задачи. Сообщения коммитов — `feat:` / `test:` / `chore:`, с trailer из системного напоминания сессии.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `package.json`, `vitest.config.js`, `.gitignore` | Проект, тесты |
| `lib/db.js` | `createDb(q, tz)`, `neonDb(url, tz)` с одним ретраем, `migrate(db)`, `dayAt(db, ts)`, `today(db)` |
| `lib/users.js` | users: заявка, allow/deny, список, админ |
| `lib/trackers.js` | trackers: add/list/get/archive |
| `lib/checkins.js` | тоггл отметки, состояние за сегодня, `claimUpdate` (дедуп) |
| `lib/stats.js` | `userStats(db, userId, today)`, `todaySnapshot(db, today)` |
| `lib/text.js` | `displayName`, `formatToday`, `clipLines` |
| `lib/menu.js` | `buildMenu(trackers, doneSet)`, `menuText(today)` |
| `lib/handlers/user.js` | `/start`, тап, fallback |
| `lib/handlers/admin.js` | `/users /allow /deny /add /list /del /stats` + их callback'и |
| `lib/bot.js` | `createBot({ token, db, adminIds, botInfo })` — сборка бота, `bot.catch` |
| `lib/config.js` | `loadConfig(env)` |
| `api/bot.js` | вебхук Vercel |
| `api/setup.js` | миграции + `setWebhook` |
| `dev.js` | локальный long polling |
| `test/helpers.js` | `makeTestDb()`, фабрики апдейтов, мок Telegram API |
| `test/*.test.js` | тесты по модулям |
| `README.md` | запуск и деплой |

---

### Task 1: Каркас проекта, подключение к БД, миграции, «сегодня»

**Files:**
- Create: `package.json`, `vitest.config.js`, `lib/db.js`, `test/helpers.js`, `test/db.test.js`

**Interfaces:**
- Produces:
  - `createDb(q, tz) → { q, tz }` где `q(text, params?) → Promise<row[]>`
  - `neonDb(url, tz) → db` (прод; один повтор при сетевой ошибке)
  - `migrate(db) → Promise<void>` (идемпотентно)
  - `dayAt(db, ts) → Promise<'YYYY-MM-DD'>` — дата `ts` (ISO-строка) в `db.tz`
  - `today(db) → Promise<'YYYY-MM-DD'>`
  - `makeTestDb(tz = 'UTC') → Promise<db>` (PGlite + migrate) и `resetDb(db)` (TRUNCATE всех таблиц)

- [ ] **Step 1: Создать `package.json` и `vitest.config.js`, поставить зависимости**

`package.json`:
```json
{
  "name": "trecker-bot",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "dev": "node --env-file=.env dev.js"
  },
  "dependencies": {
    "@neondatabase/serverless": "^1.1.0",
    "grammy": "^1.46.0"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.5.8",
    "vitest": "^5.0.0"
  }
}
```

`vitest.config.js`:
```js
export default {
  test: {
    include: ['test/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
};
```

Run: `npm install`
Expected: `node_modules/` появился, ошибок нет.

- [ ] **Step 2: Написать `test/helpers.js` (пока только БД-часть)**

```js
import { PGlite } from '@electric-sql/pglite';
import { createDb, migrate } from '../lib/db.js';

export async function makeTestDb(tz = 'UTC') {
  const pg = new PGlite();
  const q = async (text, params = []) => (await pg.query(text, params)).rows;
  const db = createDb(q, tz);
  await migrate(db);
  return db;
}

export async function resetDb(db) {
  await db.q('TRUNCATE checkins, processed, trackers, users RESTART IDENTITY CASCADE');
}
```

- [ ] **Step 3: Написать падающий тест `test/db.test.js`**

```js
import { describe, it, expect, beforeAll } from 'vitest';
import { makeTestDb } from './helpers.js';
import { migrate, dayAt, today } from '../lib/db.js';

describe('db', () => {
  let db;
  beforeAll(async () => { db = await makeTestDb('Asia/Almaty'); });

  it('migrate is idempotent and creates all tables', async () => {
    await migrate(db);
    const rows = await db.q(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
    );
    expect(rows.map((r) => r.table_name)).toEqual(['checkins', 'processed', 'trackers', 'users']);
  });

  it('dayAt converts an instant to a date in db.tz', async () => {
    // 20:30 UTC 9 сентября = 01:30 10 сентября в Алматы (UTC+5)
    expect(await dayAt(db, '2026-09-09T20:30:00Z')).toBe('2026-09-10');
    expect(await dayAt(db, '2026-09-09T18:59:00Z')).toBe('2026-09-09');
  });

  it('today returns a YYYY-MM-DD string', async () => {
    expect(await today(db)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
```

- [ ] **Step 4: Запустить тест, убедиться, что падает**

Run: `npx vitest run test/db.test.js`
Expected: FAIL — `Failed to resolve import "../lib/db.js"`.

- [ ] **Step 5: Написать `lib/db.js`**

```js
import { neon } from '@neondatabase/serverless';

export function createDb(q, tz) {
  return { q, tz };
}

function isTransient(err) {
  const s = `${err?.code ?? ''} ${err?.message ?? ''}`;
  return Boolean(err?.sourceError) || /fetch failed|ECONNRESET|ETIMEDOUT|57P01|^08/.test(s);
}

export function neonDb(url, tz) {
  const sql = neon(url);
  const q = async (text, params = []) => {
    try {
      return await sql.query(text, params);
    } catch (err) {
      if (!isTransient(err)) throw err;
      return await sql.query(text, params);
    }
  };
  return createDb(q, tz);
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id          bigint PRIMARY KEY,
     username    text,
     first_name  text,
     status      text NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     allowed_at  timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS trackers (
     id          serial PRIMARY KEY,
     title       text NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     archived_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS checkins (
     user_id     bigint NOT NULL REFERENCES users(id),
     tracker_id  int    NOT NULL REFERENCES trackers(id),
     day         date   NOT NULL,
     created_at  timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (user_id, tracker_id, day)
   )`,
  `CREATE TABLE IF NOT EXISTS processed (
     update_id   bigint PRIMARY KEY,
     at          timestamptz NOT NULL DEFAULT now()
   )`,
];

export async function migrate(db) {
  for (const stmt of SCHEMA) await db.q(stmt);
}

export async function dayAt(db, ts) {
  const [row] = await db.q('SELECT ($1::timestamptz AT TIME ZONE $2)::date::text AS d', [ts, db.tz]);
  return row.d;
}

export async function today(db) {
  const [row] = await db.q('SELECT (now() AT TIME ZONE $1)::date::text AS d', [db.tz]);
  return row.d;
}
```

- [ ] **Step 6: Запустить тест, убедиться, что проходит**

Run: `npx vitest run test/db.test.js`
Expected: PASS, 3 теста.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.js lib/db.js test/helpers.js test/db.test.js
git commit -m "feat: project scaffold, db layer, migrations, tz-aware today"
```

---

### Task 2: Пользователи и доступ

**Files:**
- Create: `lib/users.js`, `test/users.test.js`

**Interfaces:**
- Consumes: `db.q`, `makeTestDb`, `resetDb`
- Produces (все `async`, `profile = { id, username?, firstName? }`):
  - `getUser(db, id) → row | null` — row: `{ id, username, first_name, status, allowed_at }` (`id` — number)
  - `requestAccess(db, profile) → { created: boolean, user }` — создаёт `pending`, если записи нет; иначе возвращает существующую
  - `allowUser(db, id, profile = {}) → user` — upsert в `allowed`, `allowed_at = COALESCE(allowed_at, now())`
  - `denyUser(db, id) → boolean` — `denied`, false если записи нет
  - `ensureAdmin(db, profile) → user` — как `allowUser`, но обновляет имя
  - `listUsers(db) → row[]` — pending первыми, потом allowed, потом denied; внутри по `created_at`
  - `allowedUsers(db) → row[]`

- [ ] **Step 1: Написать падающий тест `test/users.test.js`**

```js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeTestDb, resetDb } from './helpers.js';
import {
  getUser, requestAccess, allowUser, denyUser, ensureAdmin, listUsers, allowedUsers,
} from '../lib/users.js';

describe('users', () => {
  let db;
  beforeAll(async () => { db = await makeTestDb(); });
  beforeEach(async () => { await resetDb(db); });

  it('requestAccess creates pending once', async () => {
    const a = await requestAccess(db, { id: 10, username: 'ivan', firstName: 'Иван' });
    expect(a.created).toBe(true);
    expect(a.user.status).toBe('pending');
    const b = await requestAccess(db, { id: 10, username: 'ivan', firstName: 'Иван' });
    expect(b.created).toBe(false);
    expect((await getUser(db, 10)).status).toBe('pending');
  });

  it('allowUser sets allowed_at once and keeps it after deny', async () => {
    await requestAccess(db, { id: 10, firstName: 'Иван' });
    const u1 = await allowUser(db, 10);
    expect(u1.status).toBe('allowed');
    expect(u1.allowed_at).toBeTruthy();
    expect(await denyUser(db, 10)).toBe(true);
    const u2 = await getUser(db, 10);
    expect(u2.status).toBe('denied');
    expect(u2.allowed_at).toEqual(u1.allowed_at);
    const u3 = await allowUser(db, 10);
    expect(u3.allowed_at).toEqual(u1.allowed_at);
  });

  it('allowUser creates a missing user as allowed', async () => {
    const u = await allowUser(db, 77);
    expect(u.status).toBe('allowed');
    expect(u.id).toBe(77);
  });

  it('denyUser returns false for unknown id', async () => {
    expect(await denyUser(db, 404)).toBe(false);
  });

  it('ensureAdmin upserts allowed and refreshes name', async () => {
    await ensureAdmin(db, { id: 1, username: 'boss', firstName: 'Босс' });
    const u = await ensureAdmin(db, { id: 1, username: 'boss2', firstName: 'Босс' });
    expect(u.status).toBe('allowed');
    expect(u.username).toBe('boss2');
  });

  it('listUsers orders pending, allowed, denied', async () => {
    await allowUser(db, 2, { firstName: 'A' });
    await requestAccess(db, { id: 3, firstName: 'P' });
    await requestAccess(db, { id: 4, firstName: 'D' });
    await denyUser(db, 4);
    expect((await listUsers(db)).map((u) => u.id)).toEqual([3, 2, 4]);
    expect((await allowedUsers(db)).map((u) => u.id)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `npx vitest run test/users.test.js`
Expected: FAIL — `Failed to resolve import "../lib/users.js"`.

- [ ] **Step 3: Написать `lib/users.js`**

```js
const COLS = 'id::int AS id, username, first_name, status, allowed_at';

export async function getUser(db, id) {
  const [row] = await db.q(`SELECT ${COLS} FROM users WHERE id = $1`, [id]);
  return row ?? null;
}

export async function requestAccess(db, { id, username = null, firstName = null }) {
  const [row] = await db.q(
    `INSERT INTO users (id, username, first_name, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (id) DO NOTHING
     RETURNING ${COLS}`,
    [id, username, firstName],
  );
  if (row) return { created: true, user: row };
  return { created: false, user: await getUser(db, id) };
}

export async function allowUser(db, id, { username = null, firstName = null } = {}) {
  const [row] = await db.q(
    `INSERT INTO users (id, username, first_name, status, allowed_at)
     VALUES ($1, $2, $3, 'allowed', now())
     ON CONFLICT (id) DO UPDATE SET
       status = 'allowed',
       allowed_at = COALESCE(users.allowed_at, now()),
       username = COALESCE(EXCLUDED.username, users.username),
       first_name = COALESCE(EXCLUDED.first_name, users.first_name)
     RETURNING ${COLS}`,
    [id, username, firstName],
  );
  return row;
}

export async function denyUser(db, id) {
  const rows = await db.q(
    `UPDATE users SET status = 'denied' WHERE id = $1 RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

export async function ensureAdmin(db, { id, username = null, firstName = null }) {
  const [row] = await db.q(
    `INSERT INTO users (id, username, first_name, status, allowed_at)
     VALUES ($1, $2, $3, 'allowed', now())
     ON CONFLICT (id) DO UPDATE SET
       status = 'allowed',
       allowed_at = COALESCE(users.allowed_at, now()),
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name
     RETURNING ${COLS}`,
    [id, username, firstName],
  );
  return row;
}

export async function listUsers(db) {
  return db.q(
    `SELECT ${COLS} FROM users
     ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'allowed' THEN 1 ELSE 2 END, created_at, id`,
  );
}

export async function allowedUsers(db) {
  return db.q(`SELECT ${COLS} FROM users WHERE status = 'allowed' ORDER BY first_name, id`);
}
```

- [ ] **Step 4: Запустить тест, убедиться, что проходит**

Run: `npx vitest run test/users.test.js`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Commit**

```bash
git add lib/users.js test/users.test.js
git commit -m "feat: users access layer (request/allow/deny/admin)"
```

---

### Task 3: Трекеры

**Files:**
- Create: `lib/trackers.js`, `test/trackers.test.js`

**Interfaces:**
- Produces:
  - `addTracker(db, title) → { id, title }`
  - `listTrackers(db) → { id, title }[]` — только активные, по `id`
  - `getTracker(db, id) → { id, title, archived: boolean } | null` — включая архивные
  - `archiveTracker(db, id) → boolean` — false если нет или уже архивирован

- [ ] **Step 1: Написать падающий тест `test/trackers.test.js`**

```js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeTestDb, resetDb } from './helpers.js';
import { addTracker, listTrackers, getTracker, archiveTracker } from '../lib/trackers.js';

describe('trackers', () => {
  let db;
  beforeAll(async () => { db = await makeTestDb(); });
  beforeEach(async () => { await resetDb(db); });

  it('add + list', async () => {
    const t = await addTracker(db, 'Прочитать 1 страницу');
    expect(t).toEqual({ id: 1, title: 'Прочитать 1 страницу' });
    await addTracker(db, 'Отжаться');
    expect(await listTrackers(db)).toEqual([
      { id: 1, title: 'Прочитать 1 страницу' },
      { id: 2, title: 'Отжаться' },
    ]);
  });

  it('archive hides from list but getTracker still finds it', async () => {
    await addTracker(db, 'A');
    expect(await archiveTracker(db, 1)).toBe(true);
    expect(await archiveTracker(db, 1)).toBe(false);
    expect(await listTrackers(db)).toEqual([]);
    expect(await getTracker(db, 1)).toEqual({ id: 1, title: 'A', archived: true });
    expect(await getTracker(db, 99)).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `npx vitest run test/trackers.test.js`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Написать `lib/trackers.js`**

```js
export async function addTracker(db, title) {
  const [row] = await db.q(
    'INSERT INTO trackers (title) VALUES ($1) RETURNING id, title',
    [title],
  );
  return row;
}

export async function listTrackers(db) {
  return db.q('SELECT id, title FROM trackers WHERE archived_at IS NULL ORDER BY id');
}

export async function getTracker(db, id) {
  const [row] = await db.q(
    'SELECT id, title, (archived_at IS NOT NULL) AS archived FROM trackers WHERE id = $1',
    [id],
  );
  return row ?? null;
}

export async function archiveTracker(db, id) {
  const rows = await db.q(
    'UPDATE trackers SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id',
    [id],
  );
  return rows.length > 0;
}
```

- [ ] **Step 4: Запустить тест, убедиться, что проходит**

Run: `npx vitest run test/trackers.test.js`
Expected: PASS, 2 теста.

- [ ] **Step 5: Commit**

```bash
git add lib/trackers.js test/trackers.test.js
git commit -m "feat: trackers layer with soft archive"
```

---

### Task 4: Отметки, тоггл, дедуп апдейтов

**Files:**
- Create: `lib/checkins.js`, `test/checkins.test.js`

**Interfaces:**
- Consumes: `allowUser`, `addTracker`
- Produces:
  - `toggleCheckin(db, userId, trackerId, today) → { done: boolean }`
  - `todayState(db, userId, today) → Set<number>` — id трекеров, отмеченных за `today`
  - `claimUpdate(db, updateId) → boolean` — true, если апдейт видим впервые; попутно чистит записи старше суток

- [ ] **Step 1: Написать падающий тест `test/checkins.test.js`**

```js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeTestDb, resetDb } from './helpers.js';
import { allowUser } from '../lib/users.js';
import { addTracker } from '../lib/trackers.js';
import { toggleCheckin, todayState, claimUpdate } from '../lib/checkins.js';

const D = '2026-09-10';

describe('checkins', () => {
  let db;
  beforeAll(async () => { db = await makeTestDb(); });
  beforeEach(async () => {
    await resetDb(db);
    await allowUser(db, 10);
    await addTracker(db, 'A');
    await addTracker(db, 'B');
  });

  it('toggle sets, second toggle clears', async () => {
    expect(await toggleCheckin(db, 10, 1, D)).toEqual({ done: true });
    expect(await todayState(db, 10, D)).toEqual(new Set([1]));
    expect(await toggleCheckin(db, 10, 1, D)).toEqual({ done: false });
    expect(await todayState(db, 10, D)).toEqual(new Set());
  });

  it('todayState is per day and per user', async () => {
    await toggleCheckin(db, 10, 1, D);
    await toggleCheckin(db, 10, 2, '2026-09-09');
    expect(await todayState(db, 10, D)).toEqual(new Set([1]));
    expect(await todayState(db, 10, '2026-09-09')).toEqual(new Set([2]));
  });

  it('claimUpdate is true once per update_id', async () => {
    expect(await claimUpdate(db, 1000)).toBe(true);
    expect(await claimUpdate(db, 1000)).toBe(false);
    expect(await claimUpdate(db, 1001)).toBe(true);
  });

  it('claimUpdate purges entries older than a day', async () => {
    await db.q("INSERT INTO processed (update_id, at) VALUES (1, now() - interval '2 days')");
    await claimUpdate(db, 2);
    const rows = await db.q('SELECT update_id::int AS id FROM processed ORDER BY 1');
    expect(rows).toEqual([{ id: 2 }]);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `npx vitest run test/checkins.test.js`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Написать `lib/checkins.js`**

```js
export async function toggleCheckin(db, userId, trackerId, today) {
  const deleted = await db.q(
    'DELETE FROM checkins WHERE user_id = $1 AND tracker_id = $2 AND day = $3::date RETURNING 1',
    [userId, trackerId, today],
  );
  if (deleted.length > 0) return { done: false };
  await db.q(
    `INSERT INTO checkins (user_id, tracker_id, day) VALUES ($1, $2, $3::date)
     ON CONFLICT DO NOTHING`,
    [userId, trackerId, today],
  );
  return { done: true };
}

export async function todayState(db, userId, today) {
  const rows = await db.q(
    'SELECT tracker_id FROM checkins WHERE user_id = $1 AND day = $2::date',
    [userId, today],
  );
  return new Set(rows.map((r) => r.tracker_id));
}

export async function claimUpdate(db, updateId) {
  const [row] = await db.q(
    `WITH ins AS (
       INSERT INTO processed (update_id) VALUES ($1)
       ON CONFLICT (update_id) DO NOTHING
       RETURNING 1
     ),
     purge AS (
       DELETE FROM processed WHERE at < now() - interval '1 day'
     )
     SELECT count(*)::int AS n FROM ins`,
    [updateId],
  );
  return row.n > 0;
}
```

- [ ] **Step 4: Запустить тест, убедиться, что проходит**

Run: `npx vitest run test/checkins.test.js`
Expected: PASS, 4 теста.

- [ ] **Step 5: Commit**

```bash
git add lib/checkins.js test/checkins.test.js
git commit -m "feat: checkin toggle and update deduplication"
```

---

### Task 5: Статистика

**Files:**
- Create: `lib/stats.js`, `test/stats.test.js`

**Interfaces:**
- Produces:
  - `userStats(db, userId, today) → { id, title, today: boolean, monthDone, monthDays, streak, misses }[]` — по каждому активному трекеру, по `id`
  - `todaySnapshot(db, today) → { id, title, done: user[], notDone: user[] }[]` — `user = { id, first_name, username }`, только `allowed`, по активным трекерам

Правила из спеки §5: `start = max(allowed_at, tracker.created_at)` в `db.tz`; `monthDays` — от `max(start, 1-е число)` по `today` включительно; `streak` — хвост, заканчивающийся сегодня или вчера; `misses` — дни от `start` по **вчера** минус отметки.

- [ ] **Step 1: Написать падающий тест `test/stats.test.js`**

```js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeTestDb, resetDb } from './helpers.js';
import { userStats, todaySnapshot } from '../lib/stats.js';

// today = 2 марта: проверяем переход через границу месяца.
const TODAY = '2026-03-02';

async function seedUser(db, id, allowedAt, name = 'U' + id) {
  await db.q(
    `INSERT INTO users (id, first_name, status, allowed_at) VALUES ($1, $2, 'allowed', $3::timestamptz)`,
    [id, name, allowedAt],
  );
}
async function seedTracker(db, title, createdAt) {
  const [r] = await db.q(
    'INSERT INTO trackers (title, created_at) VALUES ($1, $2::timestamptz) RETURNING id',
    [title, createdAt],
  );
  return r.id;
}
async function mark(db, userId, trackerId, days) {
  for (const d of days) {
    await db.q('INSERT INTO checkins (user_id, tracker_id, day) VALUES ($1, $2, $3::date)', [userId, trackerId, d]);
  }
}

describe('userStats', () => {
  let db;
  beforeAll(async () => { db = await makeTestDb('UTC'); });
  beforeEach(async () => {
    await resetDb(db);
    await seedUser(db, 10, '2026-02-20T10:00:00Z', 'Иван');
    await seedTracker(db, 'Читать', '2026-02-25T10:00:00Z'); // start = 2026-02-25
  });

  it('counts month, streak ending yesterday, and misses up to yesterday', async () => {
    await mark(db, 10, 1, ['2026-02-25', '2026-02-26', '2026-02-28', '2026-03-01']);
    const [s] = await userStats(db, 10, TODAY);
    expect(s).toEqual({
      id: 1, title: 'Читать', today: false,
      monthDone: 1,   // только 03-01
      monthDays: 2,   // 03-01, 03-02
      streak: 2,      // 02-28, 03-01
      misses: 1,      // 02-25..03-01 = 5 дней, 4 отметки
    });
  });

  it('today checkin extends streak and month, does not change misses', async () => {
    await mark(db, 10, 1, ['2026-02-28', '2026-03-01', '2026-03-02']);
    const [s] = await userStats(db, 10, TODAY);
    expect(s.today).toBe(true);
    expect(s.streak).toBe(3);
    expect(s.monthDone).toBe(2);
    expect(s.misses).toBe(3); // 02-25, 02-26, 02-27
  });

  it('gap before yesterday resets streak to 0', async () => {
    await mark(db, 10, 1, ['2026-02-25', '2026-02-26']);
    const [s] = await userStats(db, 10, TODAY);
    expect(s.streak).toBe(0);
    expect(s.misses).toBe(3);
  });

  it('no checkins at all', async () => {
    const [s] = await userStats(db, 10, TODAY);
    expect(s).toMatchObject({ today: false, monthDone: 0, monthDays: 2, streak: 0, misses: 5 });
  });

  it('start later than tracker creation uses allowed_at', async () => {
    await db.q("UPDATE users SET allowed_at = '2026-03-01T00:00:00Z' WHERE id = 10");
    const [s] = await userStats(db, 10, TODAY);
    expect(s.monthDays).toBe(2);
    expect(s.misses).toBe(1); // только 03-01
  });

  it('tracker created today: monthDays 1, misses 0', async () => {
    await seedTracker(db, 'Новый', '2026-03-02T05:00:00Z');
    const stats = await userStats(db, 10, TODAY);
    expect(stats[1]).toMatchObject({ id: 2, monthDays: 1, misses: 0, streak: 0 });
  });

  it('archived trackers are excluded', async () => {
    await db.q('UPDATE trackers SET archived_at = now() WHERE id = 1');
    expect(await userStats(db, 10, TODAY)).toEqual([]);
  });
});

describe('todaySnapshot', () => {
  let db;
  beforeAll(async () => { db = await makeTestDb('UTC'); });
  beforeEach(async () => { await resetDb(db); });

  it('groups allowed users by tracker into done / notDone', async () => {
    await seedUser(db, 10, '2026-02-01T00:00:00Z', 'Иван');
    await seedUser(db, 11, '2026-02-01T00:00:00Z', 'Маша');
    await db.q("INSERT INTO users (id, first_name, status) VALUES (12, 'Гость', 'pending')");
    await seedTracker(db, 'Читать', '2026-02-01T00:00:00Z');
    await seedTracker(db, 'Спорт', '2026-02-01T00:00:00Z');
    await mark(db, 10, 1, [TODAY]);
    const snap = await todaySnapshot(db, TODAY);
    expect(snap.map((t) => t.title)).toEqual(['Читать', 'Спорт']);
    expect(snap[0].done.map((u) => u.first_name)).toEqual(['Иван']);
    expect(snap[0].notDone.map((u) => u.first_name)).toEqual(['Маша']);
    expect(snap[1].done).toEqual([]);
    expect(snap[1].notDone.map((u) => u.id)).toEqual([10, 11]);
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `npx vitest run test/stats.test.js`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Написать `lib/stats.js`**

```js
export async function userStats(db, userId, today) {
  const rows = await db.q(
    `WITH t AS (
       SELECT tr.id, tr.title,
              GREATEST(u.allowed_at AT TIME ZONE $3, tr.created_at AT TIME ZONE $3)::date AS start
       FROM trackers tr
       CROSS JOIN users u
       WHERE u.id = $1 AND tr.archived_at IS NULL
     ),
     c AS (
       SELECT tracker_id, day FROM checkins WHERE user_id = $1 AND day <= $2::date
     ),
     runs AS (
       SELECT tracker_id, day,
              day - (row_number() OVER (PARTITION BY tracker_id ORDER BY day))::int AS grp
       FROM c
     ),
     tail AS (
       SELECT tracker_id, count(*)::int AS len, max(day) AS last
       FROM runs GROUP BY tracker_id, grp
     )
     SELECT t.id, t.title,
       EXISTS (SELECT 1 FROM c WHERE c.tracker_id = t.id AND c.day = $2::date) AS today,
       (SELECT count(*)::int FROM c
         WHERE c.tracker_id = t.id AND c.day >= date_trunc('month', $2::date)::date) AS month_done,
       GREATEST(0, $2::date - GREATEST(t.start, date_trunc('month', $2::date)::date) + 1)::int AS month_days,
       COALESCE((SELECT len FROM tail
         WHERE tail.tracker_id = t.id AND tail.last >= $2::date - 1), 0)::int AS streak,
       (GREATEST(0, $2::date - t.start)
         - (SELECT count(*) FROM c
             WHERE c.tracker_id = t.id AND c.day >= t.start AND c.day < $2::date))::int AS misses
     FROM t
     ORDER BY t.id`,
    [userId, today, db.tz],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    today: r.today,
    monthDone: r.month_done,
    monthDays: r.month_days,
    streak: r.streak,
    misses: r.misses,
  }));
}

export async function todaySnapshot(db, today) {
  const rows = await db.q(
    `SELECT tr.id, tr.title, u.id::int AS user_id, u.first_name, u.username,
       EXISTS (SELECT 1 FROM checkins c
               WHERE c.user_id = u.id AND c.tracker_id = tr.id AND c.day = $1::date) AS done
     FROM trackers tr
     CROSS JOIN users u
     WHERE tr.archived_at IS NULL AND u.status = 'allowed'
     ORDER BY tr.id, u.first_name, u.id`,
    [today],
  );
  const byTracker = new Map();
  for (const r of rows) {
    if (!byTracker.has(r.id)) byTracker.set(r.id, { id: r.id, title: r.title, done: [], notDone: [] });
    const user = { id: r.user_id, first_name: r.first_name, username: r.username };
    byTracker.get(r.id)[r.done ? 'done' : 'notDone'].push(user);
  }
  return [...byTracker.values()];
}
```

- [ ] **Step 4: Запустить тест, убедиться, что проходит**

Run: `npx vitest run test/stats.test.js`
Expected: PASS, 8 тестов. Если `misses`/`streak` расходятся — проверять по таблице в тесте вручную, не подгонять тест под SQL.

- [ ] **Step 5: Commit**

```bash
git add lib/stats.js test/stats.test.js
git commit -m "feat: per-user stats (month/streak/misses) and today snapshot"
```

---

### Task 6: Тексты и меню

**Files:**
- Create: `lib/text.js`, `lib/menu.js`, `test/text.test.js`, `test/menu.test.js`

**Interfaces:**
- Produces:
  - `displayName({ first_name, username }) → string` — `Иван (@ivan)` или `Иван`, или `id 10` если имени нет
  - `formatToday('YYYY-MM-DD') → 'Сегодня, 10 сентября'`
  - `clipLines(lines, max = 4000) → string` — строки через `\n`, при переполнении обрывает и добавляет `…и ещё N`
  - `buildMenu(trackers, doneSet) → InlineKeyboard` — по кнопке в строке, `✅ title` / `⬜️ title`, callback `t:<id>`
  - `menuText(today) → string`

- [ ] **Step 1: Написать падающие тесты**

`test/text.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { displayName, formatToday, clipLines } from '../lib/text.js';

describe('text', () => {
  it('displayName variants', () => {
    expect(displayName({ id: 1, first_name: 'Иван', username: 'ivan' })).toBe('Иван (@ivan)');
    expect(displayName({ id: 1, first_name: 'Иван', username: null })).toBe('Иван');
    expect(displayName({ id: 7, first_name: null, username: null })).toBe('id 7');
  });

  it('formatToday in Russian', () => {
    expect(formatToday('2026-09-10')).toBe('Сегодня, 10 сентября');
    expect(formatToday('2026-03-01')).toBe('Сегодня, 1 марта');
  });

  it('clipLines keeps everything when it fits', () => {
    expect(clipLines(['a', 'b'])).toBe('a\nb');
  });

  it('clipLines truncates with a tail counter', () => {
    const lines = Array.from({ length: 10 }, (_, i) => 'x'.repeat(10) + i);
    const out = clipLines(lines, 40);
    expect(out.split('\n').length).toBeLessThan(10);
    expect(out).toMatch(/…и ещё \d+$/);
    expect(out.length).toBeLessThanOrEqual(40);
  });
});
```

`test/menu.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { buildMenu, menuText } from '../lib/menu.js';

describe('menu', () => {
  it('one button per tracker with state prefix and t:<id> data', () => {
    const kb = buildMenu(
      [{ id: 1, title: 'Читать' }, { id: 2, title: 'Спорт' }],
      new Set([2]),
    );
    expect(kb.inline_keyboard).toEqual([
      [{ text: '⬜️ Читать', callback_data: 't:1' }],
      [{ text: '✅ Спорт', callback_data: 't:2' }],
    ]);
  });

  it('menuText is the formatted date', () => {
    expect(menuText('2026-09-10')).toBe('Сегодня, 10 сентября');
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться, что падают**

Run: `npx vitest run test/text.test.js test/menu.test.js`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Написать `lib/text.js` и `lib/menu.js`**

`lib/text.js`:
```js
const ruDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });

export function displayName(user) {
  const name = user.first_name?.trim();
  if (!name) return `id ${user.id}`;
  return user.username ? `${name} (@${user.username})` : name;
}

export function formatToday(today) {
  return `Сегодня, ${ruDate.format(new Date(`${today}T00:00:00Z`))}`;
}

export function clipLines(lines, max = 4000) {
  const full = lines.join('\n');
  if (full.length <= max) return full;
  const kept = [];
  let rest = lines.length;
  for (const line of lines) {
    const tail = `\n…и ещё ${rest - kept.length}`;
    const candidate = [...kept, line].join('\n');
    if (candidate.length + tail.length > max) break;
    kept.push(line);
  }
  return `${kept.join('\n')}\n…и ещё ${rest - kept.length}`;
}
```

`lib/menu.js`:
```js
import { InlineKeyboard } from 'grammy';
import { formatToday } from './text.js';

export function buildMenu(trackers, doneSet) {
  const kb = new InlineKeyboard();
  for (const t of trackers) {
    kb.text(`${doneSet.has(t.id) ? '✅' : '⬜️'} ${t.title}`, `t:${t.id}`).row();
  }
  return kb;
}

export function menuText(today) {
  return formatToday(today);
}
```

- [ ] **Step 4: Запустить тесты, убедиться, что проходят**

Run: `npx vitest run test/text.test.js test/menu.test.js`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Commit**

```bash
git add lib/text.js lib/menu.js test/text.test.js test/menu.test.js
git commit -m "feat: text helpers and tracker menu keyboard"
```

---

### Task 7: Сборка бота и хендлеры участника

**Files:**
- Create: `lib/bot.js`, `lib/handlers/user.js`, `test/bot-user.test.js`
- Modify: `test/helpers.js` — добавить фабрики апдейтов и мок API

**Interfaces:**
- Consumes: всё из Task 2–6
- Produces:
  - `createBot({ token, db, adminIds, botInfo? }) → Bot` — регистрирует `bot.catch`, админ-композер (пока пустой), хендлеры участника
  - `lib/handlers/user.js`: `registerUserHandlers(bot, { db, adminIds })`; экспорт `sendMenu(api, chatId, db)` и `showStart(ctx, { db, adminIds })` — их использует Task 8
  - helpers: `TEST_BOT_INFO`, `mockApi(bot) → calls[]` (перехватывает все вызовы Telegram API), `textUpdate(from, text, id?)`, `callbackUpdate(from, data, id?)`; `from = { id, username?, first_name? }`

Поведение (спека §6):
- любое сообщение (включая `/start`) → `showStart`: админ → `ensureAdmin` + меню; нет записи → `requestAccess`, ответ «Заявка отправлена. Ждите одобрения.», админам сообщение с кнопками `u:allow:<id>` / `u:deny:<id>`; `pending` → «Заявка на рассмотрении.»; `denied` → «Нет доступа.»; `allowed` → меню.
- меню: если трекеров нет → «Трекеров пока нет.»; иначе `menuText(today)` + `buildMenu`.
- тап `t:<id>`: не `allowed` → answer «Нет доступа»; трекер отсутствует/архивирован → answer «Трекер удалён» + перерисовка; иначе тоггл, перерисовка через `editMessageText(menuText, { reply_markup })`, answer «Отмечено ✅» / «Снято».
- прочие callback → пустой `answerCallbackQuery`.

- [ ] **Step 1: Дополнить `test/helpers.js`**

Добавить в конец файла:
```js
export const TEST_BOT_INFO = {
  id: 999, is_bot: true, first_name: 'Test', username: 'test_bot',
  can_join_groups: true, can_read_all_group_messages: false,
  supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false,
};

/** Перехватывает все вызовы Telegram API; возвращает массив { method, payload }. */
export function mockApi(bot) {
  const calls = [];
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    return Promise.resolve({ ok: true, result: { message_id: calls.length } });
  });
  return calls;
}

let seq = 1;

export function textUpdate(from, text, updateId = seq++) {
  const entities = text.startsWith('/')
    ? [{ type: 'bot_command', offset: 0, length: text.split(' ')[0].length }]
    : [];
  return {
    update_id: updateId,
    message: {
      message_id: updateId, date: 1, text, entities,
      chat: { id: from.id, type: 'private', first_name: from.first_name ?? 'X' },
      from: { id: from.id, is_bot: false, first_name: from.first_name ?? 'X', username: from.username },
    },
  };
}

export function callbackUpdate(from, data, updateId = seq++) {
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId), chat_instance: 'ci', data,
      from: { id: from.id, is_bot: false, first_name: from.first_name ?? 'X', username: from.username },
      message: {
        message_id: 500, date: 1, text: 'menu',
        chat: { id: from.id, type: 'private', first_name: from.first_name ?? 'X' },
      },
    },
  };
}

export const sent = (calls, method) => calls.filter((c) => c.method === method).map((c) => c.payload);
```

- [ ] **Step 2: Написать падающий тест `test/bot-user.test.js`**

```js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeTestDb, resetDb, TEST_BOT_INFO, mockApi, textUpdate, callbackUpdate, sent } from './helpers.js';
import { createBot } from '../lib/bot.js';
import { getUser, allowUser, denyUser } from '../lib/users.js';
import { addTracker, archiveTracker } from '../lib/trackers.js';
import { today } from '../lib/db.js';
import { todayState } from '../lib/checkins.js';

const ADMIN = { id: 1, first_name: 'Босс', username: 'boss' };
const IVAN = { id: 10, first_name: 'Иван', username: 'ivan' };

describe('user handlers', () => {
  let db, bot, calls;
  beforeAll(async () => { db = await makeTestDb(); });
  beforeEach(async () => {
    await resetDb(db);
    bot = createBot({ token: 'x', db, adminIds: [ADMIN.id], botInfo: TEST_BOT_INFO });
    calls = mockApi(bot);
  });

  it('/start from a stranger creates pending and notifies admin with buttons', async () => {
    await bot.handleUpdate(textUpdate(IVAN, '/start'));
    expect((await getUser(db, 10)).status).toBe('pending');
    const msgs = sent(calls, 'sendMessage');
    expect(msgs[0]).toMatchObject({ chat_id: 10, text: 'Заявка отправлена. Ждите одобрения.' });
    expect(msgs[1].chat_id).toBe(1);
    expect(msgs[1].text).toContain('Иван (@ivan)');
    expect(msgs[1].reply_markup.inline_keyboard.flat().map((b) => b.callback_data))
      .toEqual(['u:allow:10', 'u:deny:10']);
  });

  it('second /start while pending does not re-notify admin', async () => {
    await bot.handleUpdate(textUpdate(IVAN, '/start'));
    calls.length = 0;
    await bot.handleUpdate(textUpdate(IVAN, 'привет'));
    const msgs = sent(calls, 'sendMessage');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ chat_id: 10, text: 'Заявка на рассмотрении.' });
  });

  it('denied user gets "Нет доступа."', async () => {
    await bot.handleUpdate(textUpdate(IVAN, '/start'));
    await denyUser(db, 10);
    calls.length = 0;
    await bot.handleUpdate(textUpdate(IVAN, '/start'));
    expect(sent(calls, 'sendMessage')).toEqual([expect.objectContaining({ text: 'Нет доступа.' })]);
  });

  it('allowed user gets the menu; admin gets it without a request', async () => {
    await addTracker(db, 'Читать');
    await allowUser(db, 10);
    await bot.handleUpdate(textUpdate(IVAN, '/start'));
    await bot.handleUpdate(textUpdate(ADMIN, '/start'));
    const msgs = sent(calls, 'sendMessage');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].text).toMatch(/^Сегодня, /);
    expect(msgs[0].reply_markup.inline_keyboard).toEqual([[{ text: '⬜️ Читать', callback_data: 't:1' }]]);
    expect(msgs[1].chat_id).toBe(1);
    expect((await getUser(db, 1)).status).toBe('allowed');
  });

  it('allowed user with no trackers', async () => {
    await allowUser(db, 10);
    await bot.handleUpdate(textUpdate(IVAN, '/start'));
    expect(sent(calls, 'sendMessage')[0].text).toBe('Трекеров пока нет.');
  });

  it('tap toggles and redraws the menu', async () => {
    await addTracker(db, 'Читать');
    await allowUser(db, 10);
    const d = await today(db);

    await bot.handleUpdate(callbackUpdate(IVAN, 't:1'));
    expect(await todayState(db, 10, d)).toEqual(new Set([1]));
    expect(sent(calls, 'answerCallbackQuery')[0].text).toBe('Отмечено ✅');
    expect(sent(calls, 'editMessageText')[0]).toMatchObject({
      chat_id: 10, message_id: 500,
      reply_markup: { inline_keyboard: [[{ text: '✅ Читать', callback_data: 't:1' }]] },
    });

    await bot.handleUpdate(callbackUpdate(IVAN, 't:1'));
    expect(await todayState(db, 10, d)).toEqual(new Set());
    expect(sent(calls, 'answerCallbackQuery')[1].text).toBe('Снято');
  });

  it('tap on archived tracker answers "Трекер удалён" and redraws', async () => {
    await addTracker(db, 'Читать');
    await archiveTracker(db, 1);
    await allowUser(db, 10);
    await bot.handleUpdate(callbackUpdate(IVAN, 't:1'));
    expect(sent(calls, 'answerCallbackQuery')[0].text).toBe('Трекер удалён');
    expect(sent(calls, 'editMessageText')).toHaveLength(1);
  });

  it('tap from a non-allowed user is refused', async () => {
    await addTracker(db, 'Читать');
    await bot.handleUpdate(callbackUpdate(IVAN, 't:1'));
    expect(sent(calls, 'answerCallbackQuery')[0].text).toBe('Нет доступа');
    expect(sent(calls, 'editMessageText')).toHaveLength(0);
  });

  it('unknown callback is answered silently', async () => {
    await bot.handleUpdate(callbackUpdate(IVAN, 'zzz'));
    expect(sent(calls, 'answerCallbackQuery')).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Запустить тест, убедиться, что падает**

Run: `npx vitest run test/bot-user.test.js`
Expected: FAIL — `../lib/bot.js` не найден.

- [ ] **Step 4: Написать `lib/handlers/user.js`**

```js
import { InlineKeyboard } from 'grammy';
import { today } from '../db.js';
import { getUser, requestAccess, ensureAdmin } from '../users.js';
import { listTrackers, getTracker } from '../trackers.js';
import { toggleCheckin, todayState } from '../checkins.js';
import { buildMenu, menuText } from '../menu.js';
import { displayName } from '../text.js';

const profileOf = (from) => ({ id: from.id, username: from.username ?? null, firstName: from.first_name ?? null });

async function menuPayload(db, userId) {
  const d = await today(db);
  const trackers = await listTrackers(db);
  if (trackers.length === 0) return { text: 'Трекеров пока нет.' };
  const done = await todayState(db, userId, d);
  return { text: menuText(d), reply_markup: buildMenu(trackers, done) };
}

export async function sendMenu(api, chatId, db) {
  const { text, reply_markup } = await menuPayload(db, chatId);
  await api.sendMessage(chatId, text, reply_markup ? { reply_markup } : undefined);
}

async function notifyAdmins(api, adminIds, from) {
  const user = { id: from.id, first_name: from.first_name, username: from.username };
  const kb = new InlineKeyboard()
    .text('✅ Пустить', `u:allow:${from.id}`)
    .text('❌ Отказать', `u:deny:${from.id}`);
  for (const adminId of adminIds) {
    await api.sendMessage(adminId, `${displayName(user)} (id ${from.id}) просит доступ`, { reply_markup: kb });
  }
}

export async function showStart(ctx, { db, adminIds }) {
  const from = ctx.from;
  if (adminIds.includes(from.id)) {
    await ensureAdmin(db, profileOf(from));
    return sendMenu(ctx.api, ctx.chat.id, db);
  }
  const user = await getUser(db, from.id);
  if (!user) {
    await requestAccess(db, profileOf(from));
    await ctx.reply('Заявка отправлена. Ждите одобрения.');
    return notifyAdmins(ctx.api, adminIds, from);
  }
  if (user.status === 'allowed') return sendMenu(ctx.api, ctx.chat.id, db);
  if (user.status === 'pending') return ctx.reply('Заявка на рассмотрении.');
  return ctx.reply('Нет доступа.');
}

async function redraw(ctx, db) {
  const { text, reply_markup } = await menuPayload(db, ctx.from.id);
  try {
    await ctx.editMessageText(text, reply_markup ? { reply_markup } : undefined);
  } catch (err) {
    if (!/not modified/.test(err?.description ?? '')) throw err;
  }
}

async function onTap(ctx, { db, adminIds }) {
  const from = ctx.from;
  const user = adminIds.includes(from.id) ? await ensureAdmin(db, profileOf(from)) : await getUser(db, from.id);
  if (!user || user.status !== 'allowed') return ctx.answerCallbackQuery({ text: 'Нет доступа' });

  const trackerId = Number(ctx.match[1]);
  const tracker = await getTracker(db, trackerId);
  if (!tracker || tracker.archived) {
    await redraw(ctx, db);
    return ctx.answerCallbackQuery({ text: 'Трекер удалён' });
  }
  const { done } = await toggleCheckin(db, from.id, trackerId, await today(db));
  await redraw(ctx, db);
  return ctx.answerCallbackQuery({ text: done ? 'Отмечено ✅' : 'Снято' });
}

export function registerUserHandlers(bot, deps) {
  bot.callbackQuery(/^t:(\d+)$/, (ctx) => onTap(ctx, deps));
  bot.on('callback_query', (ctx) => ctx.answerCallbackQuery());
  bot.on('message', (ctx) => showStart(ctx, deps));
}
```

- [ ] **Step 5: Написать `lib/bot.js`**

```js
import { Bot, Composer } from 'grammy';
import { registerUserHandlers } from './handlers/user.js';

export function createBot({ token, db, adminIds, botInfo }) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  const deps = { db, adminIds };

  bot.catch(async (err) => {
    console.error('bot error', err.error ?? err);
    const ctx = err.ctx;
    try {
      if (ctx?.callbackQuery) await ctx.answerCallbackQuery({ text: 'Что-то пошло не так, попробуйте ещё раз' });
      else if (ctx?.chat) await ctx.reply('Что-то пошло не так, попробуйте ещё раз.');
    } catch { /* сообщение об ошибке не критично */ }
  });

  const admin = new Composer();
  bot.filter((ctx) => adminIds.includes(ctx.from?.id ?? -1)).use(admin);
  bot.adminComposer = admin; // Task 8 регистрирует сюда админские хендлеры

  registerUserHandlers(bot, deps);
  return bot;
}
```

- [ ] **Step 6: Запустить тест, убедиться, что проходит**

Run: `npx vitest run test/bot-user.test.js`
Expected: PASS, 9 тестов. Если grammY ругается на `botInfo` — проверить, что объект передан вторым аргументом `new Bot(token, { botInfo })`.

- [ ] **Step 7: Commit**

```bash
git add lib/bot.js lib/handlers/user.js test/helpers.js test/bot-user.test.js
git commit -m "feat: bot assembly and participant handlers (start, tap)"
```

---

### Task 8: Админские хендлеры

**Files:**
- Create: `lib/handlers/admin.js`, `test/bot-admin.test.js`
- Modify: `lib/bot.js` — подключить `registerAdminHandlers`

**Interfaces:**
- Consumes: `bot.adminComposer`, `sendMenu`, `userStats`, `todaySnapshot`, users/trackers, `clipLines`, `displayName`, `formatToday`
- Produces: `registerAdminHandlers(composer, { db, adminIds })`

Поведение (спека §6 «Админ»):
- `/users` — текст: строки `✅/⏳/🚫 Имя (@u) — id`, клавиатура: pending → `✅ Пустить Имя` + `❌ Отказать Имя`; allowed → `🚫 Отключить Имя`; denied → `✅ Пустить Имя`. Пусто → «Пользователей нет.»
- `/allow <id>` → `allowUser`, «Доступ выдан: <id>», участнику «Доступ выдан.» + меню (ошибка отправки участнику игнорируется). Неверный аргумент → «Использование: /allow <id>». `/deny <id>` аналогично: «Доступ закрыт: <id>» / «Пользователь не найден.» / «Использование: /deny <id>».
- callback `u:allow:<id>` / `u:deny:<id>` — то же, что команды, плюс `answerCallbackQuery`.
- `/add <текст>` → «Добавлен: #<id> <текст>»; пустой текст → «Использование: /add <текст>».
- `/list` → строки `#<id> <текст>` или «Трекеров нет.»
- `/del` → «Что архивировать?» + кнопки `d:<id>`; нет трекеров → «Трекеров нет.». `d:<id>` → `editMessageText('Архивировать «title»?', кнопки d:<id>:yes / d:cancel)`; `d:<id>:yes` → архив, `editMessageText('Архивирован: title')` (если уже — «Трекер не найден.»); `d:cancel` → «Отменено.»
- `/stats` → снимок: заголовок `📊 <formatToday>`, на каждый трекер блок `#id title` / `✅ имена` / `⬜️ имена` (пустые списки — `—`). Нет трекеров → «Трекеров нет.»
- `/stats <id>` → `👤 Имя (@u)` + на каждый трекер `title` / `сегодня ✅|⬜️ · месяц N/M · серия S · пропуски P`. Не найден или не allowed → «Пользователь не найден или без доступа.»
- Все списки через `clipLines`.

- [ ] **Step 1: Написать падающий тест `test/bot-admin.test.js`**

```js
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { makeTestDb, resetDb, TEST_BOT_INFO, mockApi, textUpdate, callbackUpdate, sent } from './helpers.js';
import { createBot } from '../lib/bot.js';
import { getUser, allowUser, requestAccess } from '../lib/users.js';
import { addTracker, listTrackers, getTracker } from '../lib/trackers.js';
import { toggleCheckin } from '../lib/checkins.js';
import { today } from '../lib/db.js';

const ADMIN = { id: 1, first_name: 'Босс', username: 'boss' };
const IVAN = { id: 10, first_name: 'Иван', username: 'ivan' };

describe('admin handlers', () => {
  let db, bot, calls;
  beforeAll(async () => { db = await makeTestDb(); });
  beforeEach(async () => {
    await resetDb(db);
    bot = createBot({ token: 'x', db, adminIds: [ADMIN.id], botInfo: TEST_BOT_INFO });
    calls = mockApi(bot);
  });

  it('non-admin sending /add falls through to start flow', async () => {
    await bot.handleUpdate(textUpdate(IVAN, '/add Читать'));
    expect(await listTrackers(db)).toEqual([]);
    expect(sent(calls, 'sendMessage')[0].text).toBe('Заявка отправлена. Ждите одобрения.');
  });

  it('/add and /list', async () => {
    await bot.handleUpdate(textUpdate(ADMIN, '/add Читать книгу'));
    expect(sent(calls, 'sendMessage')[0].text).toBe('Добавлен: #1 Читать книгу');
    await bot.handleUpdate(textUpdate(ADMIN, '/add'));
    expect(sent(calls, 'sendMessage')[1].text).toBe('Использование: /add <текст>');
    await bot.handleUpdate(textUpdate(ADMIN, '/list'));
    expect(sent(calls, 'sendMessage')[2].text).toBe('#1 Читать книгу');
  });

  it('/del flow: pick → confirm → archived', async () => {
    await addTracker(db, 'Читать');
    await bot.handleUpdate(textUpdate(ADMIN, '/del'));
    const pick = sent(calls, 'sendMessage')[0];
    expect(pick.text).toBe('Что архивировать?');
    expect(pick.reply_markup.inline_keyboard.flat()[0].callback_data).toBe('d:1');

    await bot.handleUpdate(callbackUpdate(ADMIN, 'd:1'));
    const confirm = sent(calls, 'editMessageText')[0];
    expect(confirm.text).toBe('Архивировать «Читать»?');
    expect(confirm.reply_markup.inline_keyboard.flat().map((b) => b.callback_data)).toEqual(['d:1:yes', 'd:cancel']);

    await bot.handleUpdate(callbackUpdate(ADMIN, 'd:1:yes'));
    expect(sent(calls, 'editMessageText')[1].text).toBe('Архивирован: Читать');
    expect((await getTracker(db, 1)).archived).toBe(true);

    await bot.handleUpdate(callbackUpdate(ADMIN, 'd:cancel'));
    expect(sent(calls, 'editMessageText')[2].text).toBe('Отменено.');
  });

  it('/users lists with status icons and action buttons', async () => {
    await requestAccess(db, { id: 10, firstName: 'Иван', username: 'ivan' });
    await allowUser(db, 11, { firstName: 'Маша' });
    await bot.handleUpdate(textUpdate(ADMIN, '/users'));
    const msg = sent(calls, 'sendMessage')[0];
    expect(msg.text).toBe('⏳ Иван (@ivan) — 10\n✅ Маша — 11');
    expect(msg.reply_markup.inline_keyboard.flat().map((b) => b.callback_data))
      .toEqual(['u:allow:10', 'u:deny:10', 'u:deny:11']);
  });

  it('u:allow button grants access, notifies admin and the user with a menu', async () => {
    await addTracker(db, 'Читать');
    await requestAccess(db, { id: 10, firstName: 'Иван' });
    await bot.handleUpdate(callbackUpdate(ADMIN, 'u:allow:10'));
    expect((await getUser(db, 10)).status).toBe('allowed');
    const msgs = sent(calls, 'sendMessage');
    expect(msgs[0]).toMatchObject({ chat_id: 1, text: 'Доступ выдан: 10' });
    expect(msgs[1]).toMatchObject({ chat_id: 10, text: 'Доступ выдан.' });
    expect(msgs[2].chat_id).toBe(10);
    expect(msgs[2].reply_markup.inline_keyboard[0][0].callback_data).toBe('t:1');
    expect(sent(calls, 'answerCallbackQuery')).toHaveLength(1);
  });

  it('/deny and /allow text commands', async () => {
    await allowUser(db, 10);
    await bot.handleUpdate(textUpdate(ADMIN, '/deny 10'));
    expect((await getUser(db, 10)).status).toBe('denied');
    expect(sent(calls, 'sendMessage')[0].text).toBe('Доступ закрыт: 10');
    await bot.handleUpdate(textUpdate(ADMIN, '/deny abc'));
    expect(sent(calls, 'sendMessage')[1].text).toBe('Использование: /deny <id>');
    await bot.handleUpdate(textUpdate(ADMIN, '/deny 555'));
    expect(sent(calls, 'sendMessage')[2].text).toBe('Пользователь не найден.');
    await bot.handleUpdate(textUpdate(ADMIN, '/allow 77'));
    expect((await getUser(db, 77)).status).toBe('allowed');
  });

  it('/stats snapshot and /stats <id> card', async () => {
    await addTracker(db, 'Читать');
    await allowUser(db, 10, { firstName: 'Иван', username: 'ivan' });
    await allowUser(db, 11, { firstName: 'Маша' });
    const d = await today(db);
    await toggleCheckin(db, 10, 1, d);

    await bot.handleUpdate(textUpdate(ADMIN, '/stats'));
    const snap = sent(calls, 'sendMessage')[0].text;
    expect(snap).toMatch(/^📊 Сегодня, /);
    expect(snap).toContain('#1 Читать\n✅ Иван (@ivan)\n⬜️ Маша');

    await bot.handleUpdate(textUpdate(ADMIN, '/stats 10'));
    const card = sent(calls, 'sendMessage')[1].text;
    expect(card).toContain('👤 Иван (@ivan)');
    expect(card).toContain('Читать\nсегодня ✅ · месяц 1/1 · серия 1 · пропуски 0');

    await bot.handleUpdate(textUpdate(ADMIN, '/stats 999'));
    expect(sent(calls, 'sendMessage')[2].text).toBe('Пользователь не найден или без доступа.');
  });
});
```

- [ ] **Step 2: Запустить тест, убедиться, что падает**

Run: `npx vitest run test/bot-admin.test.js`
Expected: FAIL — `/add` от админа проваливается в user-flow (нет хендлера), первый же `expect` по тексту падает.

- [ ] **Step 3: Написать `lib/handlers/admin.js`**

```js
import { InlineKeyboard } from 'grammy';
import { today } from '../db.js';
import { getUser, allowUser, denyUser, listUsers } from '../users.js';
import { addTracker, listTrackers, getTracker, archiveTracker } from '../trackers.js';
import { userStats, todaySnapshot } from '../stats.js';
import { displayName, formatToday, clipLines } from '../text.js';
import { sendMenu } from './user.js';

const STATUS_ICON = { pending: '⏳', allowed: '✅', denied: '🚫' };

function parseId(arg) {
  const id = Number((arg ?? '').trim());
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Сначала отвечаем админу, потом уведомляем участника: если тот заблокировал
// бота, sendMessage упадёт — админ всё равно должен увидеть результат.
async function notifyGranted(api, db, id) {
  try {
    await api.sendMessage(id, 'Доступ выдан.');
    await sendMenu(api, id, db);
  } catch (err) {
    console.error('notify user failed', err?.description ?? err);
  }
}

export function registerAdminHandlers(bot, { db }) {
  bot.command('users', async (ctx) => {
    const users = await listUsers(db);
    if (users.length === 0) return ctx.reply('Пользователей нет.');
    const kb = new InlineKeyboard();
    for (const u of users) {
      const name = displayName(u);
      if (u.status === 'pending') kb.text(`✅ Пустить ${name}`, `u:allow:${u.id}`).text(`❌ Отказать ${name}`, `u:deny:${u.id}`).row();
      else if (u.status === 'allowed') kb.text(`🚫 Отключить ${name}`, `u:deny:${u.id}`).row();
      else kb.text(`✅ Пустить ${name}`, `u:allow:${u.id}`).row();
    }
    const lines = users.map((u) => `${STATUS_ICON[u.status]} ${displayName(u)} — ${u.id}`);
    await ctx.reply(clipLines(lines), { reply_markup: kb });
  });

  bot.command('allow', async (ctx) => {
    const id = parseId(ctx.match);
    if (!id) return ctx.reply('Использование: /allow <id>');
    await allowUser(db, id);
    await ctx.reply(`Доступ выдан: ${id}`);
    await notifyGranted(ctx.api, db, id);
  });

  bot.command('deny', async (ctx) => {
    const id = parseId(ctx.match);
    if (!id) return ctx.reply('Использование: /deny <id>');
    const ok = await denyUser(db, id);
    await ctx.reply(ok ? `Доступ закрыт: ${id}` : 'Пользователь не найден.');
  });

  bot.callbackQuery(/^u:allow:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    await allowUser(db, id);
    await ctx.reply(`Доступ выдан: ${id}`);
    await ctx.answerCallbackQuery({ text: 'Доступ выдан' });
    await notifyGranted(ctx.api, db, id);
  });

  bot.callbackQuery(/^u:deny:(\d+)$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const ok = await denyUser(db, id);
    await ctx.reply(ok ? `Доступ закрыт: ${id}` : 'Пользователь не найден.');
    await ctx.answerCallbackQuery({ text: ok ? 'Отказано' : 'Не найден' });
  });

  bot.command('add', async (ctx) => {
    const title = (ctx.match ?? '').trim();
    if (!title) return ctx.reply('Использование: /add <текст>');
    const t = await addTracker(db, title);
    await ctx.reply(`Добавлен: #${t.id} ${t.title}`);
  });

  bot.command('list', async (ctx) => {
    const trackers = await listTrackers(db);
    if (trackers.length === 0) return ctx.reply('Трекеров нет.');
    await ctx.reply(clipLines(trackers.map((t) => `#${t.id} ${t.title}`)));
  });

  bot.command('del', async (ctx) => {
    const trackers = await listTrackers(db);
    if (trackers.length === 0) return ctx.reply('Трекеров нет.');
    const kb = new InlineKeyboard();
    for (const t of trackers) kb.text(`#${t.id} ${t.title}`, `d:${t.id}`).row();
    await ctx.reply('Что архивировать?', { reply_markup: kb });
  });

  bot.callbackQuery(/^d:(\d+)$/, async (ctx) => {
    const t = await getTracker(db, Number(ctx.match[1]));
    await ctx.answerCallbackQuery();
    if (!t || t.archived) return ctx.editMessageText('Трекер не найден.');
    const kb = new InlineKeyboard().text('Да, архивировать', `d:${t.id}:yes`).text('Отмена', 'd:cancel');
    await ctx.editMessageText(`Архивировать «${t.title}»?`, { reply_markup: kb });
  });

  bot.callbackQuery(/^d:(\d+):yes$/, async (ctx) => {
    const id = Number(ctx.match[1]);
    const t = await getTracker(db, id);
    const ok = t && !t.archived && (await archiveTracker(db, id));
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(ok ? `Архивирован: ${t.title}` : 'Трекер не найден.');
  });

  bot.callbackQuery('d:cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Отменено.');
  });

  bot.command('stats', async (ctx) => {
    const d = await today(db);
    const arg = (ctx.match ?? '').trim();
    if (!arg) {
      const snap = await todaySnapshot(db, d);
      if (snap.length === 0) return ctx.reply('Трекеров нет.');
      const names = (list) => (list.length ? list.map(displayName).join(', ') : '—');
      const lines = [`📊 ${formatToday(d)}`, ''];
      for (const t of snap) lines.push(`#${t.id} ${t.title}`, `✅ ${names(t.done)}`, `⬜️ ${names(t.notDone)}`, '');
      return ctx.reply(clipLines(lines).trimEnd());
    }
    const id = parseId(arg);
    const user = id ? await getUser(db, id) : null;
    if (!user || user.status !== 'allowed') return ctx.reply('Пользователь не найден или без доступа.');
    const stats = await userStats(db, id, d);
    const lines = [`👤 ${displayName(user)}`, ''];
    for (const s of stats) {
      lines.push(s.title,
        `сегодня ${s.today ? '✅' : '⬜️'} · месяц ${s.monthDone}/${s.monthDays} · серия ${s.streak} · пропуски ${s.misses}`, '');
    }
    if (stats.length === 0) lines.push('Трекеров нет.');
    await ctx.reply(clipLines(lines).trimEnd());
  });
}
```

- [ ] **Step 4: Подключить в `lib/bot.js`**

Заменить строки
```js
  const admin = new Composer();
  bot.filter((ctx) => adminIds.includes(ctx.from?.id ?? -1)).use(admin);
  bot.adminComposer = admin; // Task 8 регистрирует сюда админские хендлеры
```
на
```js
  const admin = new Composer();
  registerAdminHandlers(admin, deps);
  bot.filter((ctx) => adminIds.includes(ctx.from?.id ?? -1)).use(admin);
```
и добавить импорт `import { registerAdminHandlers } from './handlers/admin.js';`.

- [ ] **Step 5: Запустить все тесты**

Run: `npm test`
Expected: PASS — все файлы зелёные (db, users, trackers, checkins, stats, text, menu, bot-user, bot-admin).

- [ ] **Step 6: Commit**

```bash
git add lib/bot.js lib/handlers/admin.js test/bot-admin.test.js
git commit -m "feat: admin handlers (access, trackers, stats)"
```

---

### Task 9: Вебхук, setup, dev-запуск, README

**Files:**
- Create: `lib/config.js`, `api/bot.js`, `api/setup.js`, `dev.js`, `README.md`, `.env.example`, `test/config.test.js`, `test/webhook.test.js`

**Interfaces:**
- Produces:
  - `loadConfig(env) → { token, databaseUrl, adminIds: number[], tz, webhookSecret, setupSecret }`; бросает `Error('Missing env X')`
  - `handleWebhook(req, res, { cfg, db, bot }) → Promise<void>` — экспорт для тестов; `bot` должен иметь `init()` и `handleUpdate(update)`
  - `runSetup({ key, host }, { cfg, db, api }) → { status, body }` — экспорт для тестов; `api.setWebhook(url, opts)`

- [ ] **Step 1: Написать падающие тесты**

`test/config.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../lib/config.js';

const ENV = {
  BOT_TOKEN: 't', DATABASE_URL: 'postgres://x', ADMIN_IDS: '1, 2',
  TZ: 'Asia/Almaty', WEBHOOK_SECRET: 'w', SETUP_SECRET: 's',
};

describe('loadConfig', () => {
  it('parses env', () => {
    expect(loadConfig(ENV)).toEqual({
      token: 't', databaseUrl: 'postgres://x', adminIds: [1, 2],
      tz: 'Asia/Almaty', webhookSecret: 'w', setupSecret: 's',
    });
  });
  it('throws on missing var', () => {
    expect(() => loadConfig({ ...ENV, TZ: '' })).toThrow('Missing env TZ');
  });
});
```

`test/webhook.test.js`:
```js
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { makeTestDb, resetDb } from './helpers.js';
import { handleWebhook } from '../api/bot.js';
import { runSetup } from '../api/setup.js';

const cfg = { webhookSecret: 'sec', setupSecret: 'key', token: 't', tz: 'UTC', adminIds: [1] };

function fakeRes() {
  return {
    code: null, body: undefined,
    status(c) { this.code = c; return this; },
    end() { this.ended = true; },
    json(b) { this.body = b; this.ended = true; },
  };
}
const req = (secret, update) => ({
  method: 'POST',
  headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {},
  body: update,
});

describe('handleWebhook', () => {
  let db, bot;
  beforeAll(async () => { db = await makeTestDb(); });
  beforeEach(async () => {
    await resetDb(db);
    bot = { init: vi.fn().mockResolvedValue(), handleUpdate: vi.fn().mockResolvedValue() };
  });

  it('rejects a wrong or missing secret with 401 and does not touch the bot', async () => {
    const res = fakeRes();
    await handleWebhook(req('nope', { update_id: 1 }), res, { cfg, db, bot });
    expect(res.code).toBe(401);
    const res2 = fakeRes();
    await handleWebhook(req(null, { update_id: 1 }), res2, { cfg, db, bot });
    expect(res2.code).toBe(401);
    expect(bot.handleUpdate).not.toHaveBeenCalled();
  });

  it('passes a fresh update to the bot and answers 200', async () => {
    const res = fakeRes();
    await handleWebhook(req('sec', { update_id: 5 }), res, { cfg, db, bot });
    expect(res.code).toBe(200);
    expect(bot.handleUpdate).toHaveBeenCalledWith({ update_id: 5 });
  });

  it('drops a duplicate update_id', async () => {
    await handleWebhook(req('sec', { update_id: 7 }), fakeRes(), { cfg, db, bot });
    const res = fakeRes();
    await handleWebhook(req('sec', { update_id: 7 }), res, { cfg, db, bot });
    expect(res.code).toBe(200);
    expect(bot.handleUpdate).toHaveBeenCalledTimes(1);
  });

  it('still answers 200 when the bot throws', async () => {
    bot.handleUpdate.mockRejectedValue(new Error('boom'));
    const res = fakeRes();
    await handleWebhook(req('sec', { update_id: 9 }), res, { cfg, db, bot });
    expect(res.code).toBe(200);
  });

  it('non-POST gets 405', async () => {
    const res = fakeRes();
    await handleWebhook({ method: 'GET', headers: {} }, res, { cfg, db, bot });
    expect(res.code).toBe(405);
  });
});

describe('runSetup', () => {
  let db;
  beforeAll(async () => { db = await makeTestDb(); });

  it('rejects a wrong key', async () => {
    const api = { setWebhook: vi.fn() };
    const out = await runSetup({ key: 'bad', host: 'h' }, { cfg, db, api });
    expect(out.status).toBe(401);
    expect(api.setWebhook).not.toHaveBeenCalled();
  });

  it('migrates and sets the webhook with the secret', async () => {
    const api = { setWebhook: vi.fn().mockResolvedValue(true) };
    const out = await runSetup({ key: 'key', host: 'my.vercel.app' }, { cfg, db, api });
    expect(out).toEqual({ status: 200, body: { ok: true, webhook: 'https://my.vercel.app/api/bot' } });
    expect(api.setWebhook).toHaveBeenCalledWith('https://my.vercel.app/api/bot', { secret_token: 'sec' });
  });
});
```

- [ ] **Step 2: Запустить тесты, убедиться, что падают**

Run: `npx vitest run test/config.test.js test/webhook.test.js`
Expected: FAIL — модули не найдены.

- [ ] **Step 3: Написать `lib/config.js`**

```js
export function loadConfig(env) {
  const need = (key) => {
    const v = env[key];
    if (!v) throw new Error(`Missing env ${key}`);
    return v;
  };
  return {
    token: need('BOT_TOKEN'),
    databaseUrl: need('DATABASE_URL'),
    adminIds: need('ADMIN_IDS').split(',').map((s) => Number(s.trim())).filter(Number.isInteger),
    tz: need('TZ'),
    webhookSecret: need('WEBHOOK_SECRET'),
    setupSecret: need('SETUP_SECRET'),
  };
}
```

- [ ] **Step 4: Написать `api/bot.js`**

```js
import { loadConfig } from '../lib/config.js';
import { neonDb } from '../lib/db.js';
import { createBot } from '../lib/bot.js';
import { claimUpdate } from '../lib/checkins.js';

let cached;
function deps() {
  if (!cached) {
    const cfg = loadConfig(process.env);
    const db = neonDb(cfg.databaseUrl, cfg.tz);
    const bot = createBot({ token: cfg.token, db, adminIds: cfg.adminIds });
    cached = { cfg, db, bot };
  }
  return cached;
}

export async function handleWebhook(req, res, { cfg, db, bot }) {
  if (req.method !== 'POST') return res.status(405).end();
  if (req.headers['x-telegram-bot-api-secret-token'] !== cfg.webhookSecret) return res.status(401).end();

  const update = req.body;
  try {
    if (!update?.update_id || !(await claimUpdate(db, update.update_id))) return res.status(200).end();
    await bot.init();
    await bot.handleUpdate(update);
  } catch (err) {
    console.error('webhook error', err);
  }
  return res.status(200).end();
}

export default function handler(req, res) {
  return handleWebhook(req, res, deps());
}
```

Примечание: `bot.init()` у grammY идемпотентен — после первого успешного `getMe` повторные вызовы ничего не делают, а после неудачного можно повторить на следующем запросе.

- [ ] **Step 5: Написать `api/setup.js`**

```js
import { Bot } from 'grammy';
import { loadConfig } from '../lib/config.js';
import { neonDb, migrate } from '../lib/db.js';

export async function runSetup({ key, host }, { cfg, db, api }) {
  if (!key || key !== cfg.setupSecret) return { status: 401, body: { ok: false } };
  await migrate(db);
  const webhook = `https://${host}/api/bot`;
  await api.setWebhook(webhook, { secret_token: cfg.webhookSecret });
  return { status: 200, body: { ok: true, webhook } };
}

export default async function handler(req, res) {
  const cfg = loadConfig(process.env);
  const db = neonDb(cfg.databaseUrl, cfg.tz);
  const api = new Bot(cfg.token).api;
  const { status, body } = await runSetup({ key: req.query?.key, host: req.headers.host }, { cfg, db, api });
  res.status(status).json(body);
}
```

- [ ] **Step 6: Написать `dev.js` и `.env.example`**

`dev.js`:
```js
import { loadConfig } from './lib/config.js';
import { neonDb, migrate } from './lib/db.js';
import { createBot } from './lib/bot.js';

const cfg = loadConfig(process.env);
const db = neonDb(cfg.databaseUrl, cfg.tz);
await migrate(db);
const bot = createBot({ token: cfg.token, db, adminIds: cfg.adminIds });
await bot.api.deleteWebhook();
console.log('polling… (Ctrl+C для выхода)');
bot.start();
```

`.env.example`:
```
BOT_TOKEN=123456:ABC
DATABASE_URL=postgres://user:pass@ep-xxx.neon.tech/db?sslmode=require
ADMIN_IDS=123456789
TZ=Asia/Almaty
WEBHOOK_SECRET=long-random-string
SETUP_SECRET=another-long-random-string
```

- [ ] **Step 7: Запустить все тесты**

Run: `npm test`
Expected: PASS, все файлы.

- [ ] **Step 8: Написать `README.md`**

```markdown
# Трекер привычек в Telegram

Бот для закрытого круга: участники одним тапом отмечают привычки за сегодня,
админ выдаёт доступ, ведёт трекеры и смотрит статистику. Работает на Vercel
(webhook) + Neon Postgres. Дизайн: `docs/superpowers/specs/`.

## Команды

Участник: `/start` — меню трекеров; тап ставит/снимает отметку за сегодня.

Админ: `/users`, `/allow <id>`, `/deny <id>` — доступ; `/add <текст>`, `/list`,
`/del` — трекеры; `/stats` — срез за сегодня, `/stats <id>` — карточка участника.

## Переменные окружения

| Имя | Что |
|---|---|
| `BOT_TOKEN` | токен от @BotFather |
| `DATABASE_URL` | Neon (ставится Marketplace-интеграцией) |
| `ADMIN_IDS` | Telegram id админов через запятую |
| `TZ` | часовой пояс «сегодня», напр. `Asia/Almaty` |
| `WEBHOOK_SECRET` | секрет вебхука (любая длинная строка) |
| `SETUP_SECRET` | ключ для `/api/setup` |

## Локально

```
cp .env.example .env   # заполнить
npm install
npm test
npm run dev            # long polling, вебхук временно снимается
```

## Деплой

1. `npm i -g vercel && vercel link`
2. Neon: `vercel integration add neon` (или через Marketplace в дашборде) — появится `DATABASE_URL`.
3. `vercel env add BOT_TOKEN production` и так же `ADMIN_IDS`, `TZ`, `WEBHOOK_SECRET`, `SETUP_SECRET`.
4. `vercel deploy --prod`
5. Открыть `https://<домен>/api/setup?key=<SETUP_SECRET>` — создаст таблицы и поставит вебхук.
   Повторять после смены домена; после обычных деплоев не нужно.
```

- [ ] **Step 9: Commit**

```bash
git add lib/config.js api/bot.js api/setup.js dev.js .env.example README.md test/config.test.js test/webhook.test.js
git commit -m "feat: vercel webhook, setup endpoint, local dev runner, README"
```

---

## Self-Review

**Spec coverage.** §2 решения → Task 2 (`allowed_at` не стирается), Task 3 (архив), Task 5 (start = max). §3 структура → все файлы в таблице выше (спека дополняется: `users/trackers/checkins/config/bot/text.js` вместо одного `db.js`). §4 схема, тоггл, дедуп → Task 1, 4. §5 статистика → Task 5, форматы вывода → Task 8. §6 участник → Task 7; админ, `/allow` для отсутствующего, fallback на `/start` → Task 8 (композер с фильтром). §7 секрет вебхука, `/api/setup` за ключом, всегда 200, ретрай Neon → Task 9, Task 1. §8 тесты → каждая задача; PGlite вместо ветки Neon. §9 деплой → README в Task 9.

**Placeholders.** Нет TBD/TODO; каждый шаг с кодом.

**Type consistency.** `db = { q, tz }` везде; `today` — строка; `getTracker` возвращает `archived: boolean` (используется в Task 7 и 8); `displayName` принимает `{ id, first_name, username }` — в `notifyAdmins` (Task 7) объект собирается из `from` с теми же ключами; `sendMenu(api, chatId, db)` — сигнатура одинакова в Task 7 и 8; `mockApi` возвращает `{ message_id }`, чего достаточно для `ctx.reply`/`editMessageText`.
