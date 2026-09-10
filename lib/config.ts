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
