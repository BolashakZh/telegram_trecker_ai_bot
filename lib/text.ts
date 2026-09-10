export type NameParts = {
  id: number
  display_name?: string | null
  first_name?: string | null
  username?: string | null
}

export function personName(u: NameParts): string {
  return u.display_name || u.first_name || (u.username ? `@${u.username}` : `id ${u.id}`)
}
