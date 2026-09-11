function req(name: string): string {
  // Пробелы по краям — типичный артефакт вставки в веб-форму; Telegram из-за них отвергает URL.
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`Не задана переменная окружения ${name}`)
  return v
}

export const config = {
  botToken: () => req('BOT_TOKEN'),
  databaseUrl: () => req('DATABASE_URL'),
  // TZ зарезервирован Vercel и не задаётся в проекте — поэтому APP_TZ; локально сойдёт и TZ.
  tz: () => process.env.APP_TZ || process.env.TZ || 'Asia/Almaty',
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
