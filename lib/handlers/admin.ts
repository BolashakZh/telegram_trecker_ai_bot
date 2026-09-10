import type { Bot } from 'grammy'
import type { BotDeps } from './user.ts'

// Заглушка на задачу 9: /bind и остальные админские команды появятся там.
// Регистрируется в lib/bot.ts до registerUser, потому что message:text
// в registerUser перехватывает любой текст.
export function registerAdmin(_bot: Bot, _deps: BotDeps): void {}
