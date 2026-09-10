import { requireAdmin } from './auth.ts'
import { config } from './config.ts'

export function admin(req: Request) {
  return requireAdmin(req, {
    botToken: config.botToken(),
    adminIds: config.adminIds(),
    devAdminId: config.devAdminId(),
  })
}
